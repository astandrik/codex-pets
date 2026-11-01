import {randomUUID} from "node:crypto";
import {describe, expect, it, vi} from "vitest";
import {MemoryStore} from "./test-store";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, STAGE_NAMES, LEASE_MS} from "./model";
import type {CliCause} from "./cli-cause";

const usage = {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04};
const bad = () => new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
  {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined,
  [{state: "failed", kind: "invalid", frame: 1, actual: 389, expected: 9003}]);
async function fixture(successAt = 3, budgetUsd = 50) {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-10-31T12:00:00Z"), enabled: true};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true,
    automaticAnimationRepair: () => clock.enabled, budgetUsd: () => budgetUsd, secret: () => "automatic-repair-worker-test-secret"});
  const input = {prompt: "Synthetic character", requestId: randomUUID()};
  const accepted = await service.generate(input, "203.0.113.23");
  const calls: string[] = [], waits: number[] = [];
  const generate = vi.fn(async (name: string) => {calls.push(name); return {bytes: Buffer.from(name + calls.filter(n => n === name).length), usage, generationMs: 1};});
  const compose = vi.fn(async () => {if (calls.filter(n => n === "failed").length < successAt) throw bad(); return Buffer.from("atlas");});
  const sessions: number[] = [], cleanups: number[] = [];
  const open = vi.fn(async () => {const id = sessions.length; sessions.push(id); return {generate, compose,
    prepare: async () => undefined, cleanup: async () => {cleanups.push(id);}};});
  const worker = createSpriteGenerationWorker({service, store, now: () => clock.now,
    wait: async ms => {waits.push(ms); clock.now += ms;}, renderer: {open}, build: async () => ({"pet.zip": Buffer.from("zip")})});
  return {store, clock, service, input, accepted, generate, compose, calls, waits, sessions, cleanups, worker};
}

async function crashedInitialFixture() {
  const f = await fixture();
  let job = (await f.service.claim("before-crash"))!;
  job = await f.service.beginStage(job, "base");
  job = await f.service.saveStage(job, "base", Buffer.from("base"), {usage, generationMs: 1});
  job = await f.service.beginStages(job, STAGE_NAMES.filter(name => name !== "base"));
  for (const name of STAGE_NAMES.filter(name => name !== "base")) {
    const token = job.animationRepair!.attempts.find(a => a.state === name)!.token;
    await f.service.startAnimationAttempt(job, name, token);
    if (name === "failed") await f.service.failAnimationAttempt(job, name, token,
      new GenerationError("outcome_unknown", undefined, undefined, undefined,
        {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"}));
    else await f.service.saveAnimationAttempt(job, name, token, Buffer.from(name), {usage, generationMs: 1});
  }
  f.clock.now += LEASE_MS + 1;
  f.compose.mockResolvedValue(Buffer.from("atlas"));
  return f;
}

describe("automatic quality repair", () => {
  it("retries only the invalid row until the third image passes, in fresh sessions", async () => {
    const f = await fixture();
    const outcome = await f.worker("owner");
    expect(outcome, (await f.store.readJob(f.accepted.generationId))?.error).toBe("completed");
    expect(f.calls.filter(n => n === "failed")).toHaveLength(3);
    for (const name of STAGE_NAMES.filter(n => n !== "failed")) expect(f.calls.filter(n => n === name)).toHaveLength(1);
    expect(f.sessions).toHaveLength(3);
    expect(new Set(f.cleanups).size).toBe(3);
    const job = (await f.store.readJob(f.accepted.generationId))!;
    expect(job.animationRepair?.phase).toBe("complete");
    expect(job.animationRepair?.attempts.filter(a => a.state === "failed")).toHaveLength(3);
    expect(job.expiresAt).toBe(Date.parse("2026-11-01T12:00:00Z"));
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-31"]).toBe(560000);
  });

  it("stops at four calls with current diagnostics and never starts a fifth", async () => {
    const f = await fixture(5);
    expect(await f.worker("owner")).toBe("failed");
    expect(await f.worker("another-owner")).toBe("idle");
    expect(f.calls.filter(n => n === "failed")).toHaveLength(4);
    const job = (await f.store.readJob(f.accepted.generationId))!;
    expect(job.animationRepair?.phase).toBe("stopped");
    expect(job.assemblyIssues).toEqual([{state: "failed", kind: "invalid", frame: 1, actual: 389, expected: 9003}]);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  });

  it("shares the limit between transport and quality retries", async () => {
    const f = await fixture(4);
    const normal = f.generate.getMockImplementation()!;
    f.generate.mockImplementation(async name => {
      if (name === "failed" && !f.calls.includes(name)) {
        f.calls.push(name);
        throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"});
      }
      return normal(name);
    });
    expect(await f.worker("owner")).toBe("completed");
    expect(f.calls.filter(n => n === "failed")).toHaveLength(4);
  });

  it.each<CliCause>([{kind: "remote_disconnected"}, {kind: "incomplete_response"},
    {kind: "http_error", httpStatus: 500}, {kind: "http_error", httpStatus: 520}])(
    "runs the next job after four attempts exhaust a quality repair with $kind $httpStatus", async cause => {
      const f = await fixture();
      const next = await f.service.generate({prompt: "Next character", requestId: randomUUID()}, "203.0.113.24");
      const generate = f.generate.getMockImplementation()!;
      f.generate.mockImplementation(async name => {
        if (name === "failed" && f.calls.includes(name)) {
          f.calls.push(name);
          throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
            {boundary: "provider_cli", reason: "process_exit"}, cause);
        }
        return generate(name);
      });

      expect(await f.worker("owner")).toBe("failed");
      expect(f.calls.filter(name => name === "failed")).toHaveLength(4);
      const failed = structuredClone((await f.store.readJob(f.accepted.generationId))!);
      expect(failed.stages.every(stage => stage.status === "completed")).toBe(true);
      expect(failed.animationRepair!.attempts.filter(a => a.state === "failed").map(a => a.status))
        .toEqual(["saved", "failed", "failed", "failed"]);
      for (const name of STAGE_NAMES) {
        if (name !== "failed") expect(f.calls.filter(n => n === name)).toHaveLength(1);
        expect(await f.store.readArtifact(failed.id, `stage-${name}.png`, f.clock.now)).toEqual(Buffer.from(name + "1"));
      }
      const budget = JSON.parse(f.store.ledger.get("budget")!.value);
      expect(budget.spent["2026-10-31"]).toBe(480000);
      expect(budget.reservations[failed.id]).toEqual({remainingMicroUsd: 0, unknown: true});
      expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();

      f.generate.mockImplementation(generate);
      f.compose.mockResolvedValue(Buffer.from("atlas"));
      expect(await f.worker("next-owner")).toBe("completed");
      expect((await f.store.readJob(next.generationId))?.status).toBe("completed");
      expect(await f.store.readJob(failed.id)).toEqual(failed);
      expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[failed.id]).toEqual({remainingMicroUsd: 0, unknown: true});
    },
  );

  it("keeps the queue paused for a quality failure mixed with an unconfirmed saved image", async () => {
    const f = await fixture();
    const generate = f.generate.getMockImplementation()!, save = f.service.saveAnimationAttempt;
    f.generate.mockImplementation(async name => {
      if (name === "failed" && f.calls.includes(name)) {
        f.calls.push(name);
        throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"});
      }
      return generate(name);
    });
    f.compose.mockRejectedValue(new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
      {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined,
      [{state: "failed", kind: "invalid"}, {state: "running", kind: "invalid"}]));
    vi.spyOn(f.service, "saveAnimationAttempt").mockImplementation(async (...args) => {
      if (args[1] === "running" && f.calls.filter(name => name === "running").length > 1) throw Error("checkpoint unavailable");
      return save(...args);
    });
    expect(await f.worker("owner")).toBe("failed");
    const job = (await f.store.readJob(f.accepted.generationId))!;
    expect(job.animationRepair!.attempts.filter(a => a.state === "failed").at(-1)?.status).toBe("failed");
    expect(job.animationRepair!.attempts.filter(a => a.state === "running").at(-1)?.status).toBe("started");
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
    expect(await f.worker("replacement")).toBe("idle");
  });

  it("stops before another quality attempt when the shared budget is exhausted", async () => {
    const f = await fixture(4, .5);
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls.filter(name => name === "failed")).toHaveLength(2);
    const job = (await f.store.readJob(f.accepted.generationId))!;
    expect(job.error).toBe("budget_exhausted");
    expect(job.expiresAt - job.createdAt).toBe(86400000);
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-31"]).toBe(520000);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  });

  it("does not guess a row when diagnostics are missing", async () => {
    const f = await fixture(); f.compose.mockRejectedValue(new GenerationError("invalid_sprite_extraction"));
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls).toHaveLength(12);
    expect(f.waits).toEqual([]);
  });

  it("does not treat provider diagnostics as a local quality failure", async () => {
    const f = await fixture();
    f.compose.mockRejectedValue(new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
      {boundary: "provider_cli", reason: "process_exit"}, undefined, undefined, [{state: "failed", kind: "invalid"}]));
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls).toHaveLength(12);
  });

  it("keeps the first results but prevents additional calls after disabling repair", async () => {
    const f = await fixture(); f.clock.enabled = false;
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls).toHaveLength(12);
    expect((await f.store.readJob(f.accepted.generationId))?.error).toBe("generation_disabled");
    expect(await f.store.readArtifact(f.accepted.generationId, "stage-idle.png", f.clock.now)).not.toBeNull();
  });

  it("resumes a reserved quality attempt after a worker restart without losing its slot", async () => {
    const f = await fixture(2);
    let reservedToken = "";
    f.compose.mockImplementationOnce(async () => {
      const job = (await f.store.readJob(f.accepted.generationId))!;
      await f.service.planAnimationRepair(job, bad().assemblyIssues!);
      reservedToken = (await f.service.reserveAnimationAttempt(job, "failed", "quality")).attempt.token;
      throw new Error("synthetic process exit before provider call");
    });
    await expect(f.worker("old-owner")).rejects.toThrow("synthetic process exit");
    f.clock.now += LEASE_MS + 1;
    expect(await f.worker("new-owner")).toBe("completed");
    const attempts = (await f.store.readJob(f.accepted.generationId))!.animationRepair!.attempts.filter(a => a.state === "failed");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({token: reservedToken, status: "saved"});
    expect(f.calls.filter(n => n === "failed")).toHaveLength(2);
  });

  it("does not call the provider after a lost start acknowledgement", async () => {
    const f = await fixture(); const start = f.service.startAnimationAttempt;
    vi.spyOn(f.service, "startAnimationAttempt").mockImplementationOnce(async (...args) => {await start(...args); throw Error("lost start ACK");});
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls).not.toContain("idle");
    expect(await f.worker("replacement")).toBe("idle");
  });

  it("reconciles a committed save ACK without another image or charge", async () => {
    const f = await fixture(1); const save = f.service.saveAnimationAttempt;
    vi.spyOn(f.service, "saveAnimationAttempt").mockImplementationOnce(async (...args) => {await save(...args); throw Error("lost save ACK");});
    expect(await f.worker("owner")).toBe("completed");
    expect(f.calls).toHaveLength(12);
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-31"]).toBe(480000);
  });

  it("reconciles a reserved quality ACK using the same slot", async () => {
    const f = await fixture(2); const reserve = f.service.reserveAnimationAttempt;
    vi.spyOn(f.service, "reserveAnimationAttempt").mockImplementationOnce(async (...args) => {await reserve(...args); throw Error("lost reserve ACK");});
    expect(await f.worker("owner")).toBe("completed");
    expect(f.calls.filter(n => n === "failed")).toHaveLength(2);
    expect((await f.store.readJob(f.accepted.generationId))!.animationRepair!.attempts.filter(a => a.state === "failed")).toHaveLength(2);
  });

  it.each([{phase: "initial", ordinal: 1, spent: 440000}, {phase: "quality", ordinal: 2, spent: 480000},
    {phase: "quality", ordinal: 4, spent: 480000}])(
    "reconciles a lost failure ACK at $phase attempt $ordinal without a fifth call or queue pause", async ({phase, ordinal, spent}) => {
      const f = await fixture();
      const next = await f.service.generate({prompt: "Next character", requestId: randomUUID()}, "203.0.113.24");
      const normal = f.generate.getMockImplementation()!, fail = f.service.failAnimationAttempt;
      f.generate.mockImplementation(async name => {
        if (name === "failed" && (phase === "initial" || f.calls.includes(name))) {
          f.calls.push(name);
          throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
            {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"});
        }
        return normal(name);
      });
      vi.spyOn(f.service, "failAnimationAttempt").mockImplementation(async (...args) => {
        const saved = await fail(...args);
        if (saved.animationRepair!.attempts.find(a => a.token === args[2])?.ordinal === ordinal) throw Error("lost failure ACK");
        return saved;
      });
      expect(await f.worker("owner")).toBe("failed");
      expect(f.calls.filter(name => name === "failed")).toHaveLength(4);
      const failed = structuredClone((await f.store.readJob(f.accepted.generationId))!);
      expect(failed.animationRepair!.attempts.filter(a => a.state === "failed").at(-1))
        .toMatchObject({ordinal: 4, status: "failed", failure: {code: "outcome_unknown", cliCause: {kind: "remote_disconnected"}}});
      expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-31"]).toBe(spent);
      expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[failed.id]).toEqual({remainingMicroUsd: 0, unknown: true});
      expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
      for (const name of STAGE_NAMES.filter(name => name !== "failed")) {
        expect(await f.store.readArtifact(failed.id, `stage-${name}.png`, f.clock.now)).toEqual(Buffer.from(name + "1"));
      }
      f.generate.mockImplementation(normal);
      f.compose.mockResolvedValue(Buffer.from("atlas"));
      expect(await f.worker("next-owner")).toBe("completed");
      expect((await f.store.readJob(next.generationId))?.status).toBe("completed");
      expect(await f.store.readJob(failed.id)).toEqual(failed);
    },
  );

  it.each(["uncommitted", "unavailable readback", "wrong token", "wrong diagnostic", "wrong cause", "unknown status"])(
    "keeps the protective pause for a failure ACK with %s evidence", async evidence => {
      const f = await fixture(), fail = f.service.failAnimationAttempt;
      f.generate.mockImplementation(async name => {
        f.calls.push(name);
        if (name === "failed") throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "remote_disconnected"});
        return {bytes: Buffer.from(name), usage, generationMs: 1};
      });
      vi.spyOn(f.service, "failAnimationAttempt").mockImplementation(async (...args) => {
        if (evidence === "uncommitted") throw Error("write unavailable");
        await fail(...args);
        if (evidence === "unavailable readback") vi.spyOn(f.store, "readJob").mockRejectedValueOnce(Error("read unavailable"));
        else await f.store.transaction(async tx => {
          const current = (await tx.getJob(f.accepted.generationId))!;
          const attempt = current.animationRepair!.attempts.find(a => a.token === args[2])!;
          if (evidence === "wrong token") attempt.token = randomUUID();
          if (evidence === "wrong diagnostic") attempt.failure!.diagnostic = {boundary: "provider_cli", reason: "process_timeout"};
          if (evidence === "wrong cause") attempt.failure!.cliCause = {kind: "http_error", httpStatus: 500};
          if (evidence === "unknown status") attempt.status = "unknown";
          await tx.putJob(current);
        });
        throw Error("lost failure ACK");
      });
      expect(await f.worker("owner")).toBe("failed");
      expect(f.calls.filter(name => name === "failed")).toHaveLength(1);
      expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
      expect(await f.worker("replacement")).toBe("idle");
    },
  );

  it("reconciles a lost reservation ACK after restart with the same token and request", async () => {
    const f = await crashedInitialFixture(), reserve = f.service.reserveAnimationAttempt;
    let reservedToken = "";
    vi.spyOn(f.service, "reserveAnimationAttempt").mockImplementationOnce(async (...args) => {
      const saved = await reserve(...args); reservedToken = saved.attempt.token;
      throw Error("lost reserve ACK");
    });
    expect(await f.worker("after-crash")).toBe("completed");
    expect(f.calls).toEqual(["failed"]);
    const job = (await f.store.readJob(f.accepted.generationId))!;
    expect(job.animationRepair!.attempts.filter(a => a.state === "failed")).toHaveLength(2);
    expect(job.animationRepair!.attempts.filter(a => a.state === "failed").at(-1)).toMatchObject({ordinal: 2, token: reservedToken, status: "saved"});
    expect((await f.service.generate(f.input, "203.0.113.23")).generationId).toBe(job.id);
    expect(f.store.jobs.size).toBe(1);
    expect(job.expiresAt).toBe(Date.parse("2026-11-01T12:00:00Z"));
    expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-31"]).toBe(480000);
    for (const name of STAGE_NAMES.filter(name => name !== "failed")) {
      expect(await f.store.readArtifact(job.id, `stage-${name}.png`, f.clock.now)).toEqual(Buffer.from(name));
    }
  });

  it.each(["uncommitted", "unavailable readback"])("does not generate after restart when a reservation has %s evidence", async evidence => {
    const f = await crashedInitialFixture(), reserve = f.service.reserveAnimationAttempt;
    vi.spyOn(f.service, "reserveAnimationAttempt").mockImplementationOnce(async (...args) => {
      if (evidence === "uncommitted") throw Error("write unavailable");
      await reserve(...args);
      vi.spyOn(f.store, "readJob").mockRejectedValueOnce(Error("read unavailable"));
      throw Error("lost reserve ACK");
    });
    expect(await f.worker("after-crash")).toBe("failed");
    expect(f.calls).toEqual([]);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBe("outcome_unknown");
  });

  it("bounds eleven simultaneously failing rows and preserves the base", async () => {
    const f = await fixture();
    f.compose.mockImplementation(async () => {
      if (STAGE_NAMES.filter(n => n !== "base").some(name => f.calls.filter(n => n === name).length < 4)) {
        throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined, {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined,
          STAGE_NAMES.filter(n => n !== "base").map(state => ({state, kind: "invalid"})));
      }
      return Buffer.from("atlas");
    });
    expect(await f.worker("owner")).toBe("completed");
    expect(f.calls).toHaveLength(45);
    expect(f.calls.filter(n => n === "base")).toHaveLength(1);
    expect((await f.store.readJob(f.accepted.generationId))!.animationRepair!.attempts).toHaveLength(44);
  });

  it("does not spend on another bad row when a required row has exhausted its limit", async () => {
    const f = await fixture(5);
    f.compose.mockImplementation(async () => {throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
      {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined,
      [{state: "failed", kind: "invalid"}, ...(f.calls.filter(n => n === "failed").length === 4 ? [{state: "idle", kind: "invalid"}] : [])]);});
    expect(await f.worker("owner")).toBe("failed");
    expect(f.calls.filter(n => n === "failed")).toHaveLength(4);
    expect(f.calls.filter(n => n === "idle")).toHaveLength(1);
  });
});
