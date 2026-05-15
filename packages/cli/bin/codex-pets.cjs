#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

var path = require("path");
var url = require("url");

var MIN_NODE_MAJOR = 18;
var currentNode = process.versions && process.versions.node
  ? process.versions.node
  : "unknown";
var currentMajor = parseInt(String(currentNode).split(".")[0], 10);

if (!currentMajor || currentMajor < MIN_NODE_MAJOR) {
  console.error(
    "codex-pets requires Node.js 18 or newer. Current Node.js is " +
      currentNode +
      ".\nUpdate Node.js, then retry: npx @astandrik/codex-pets install <slug>"
  );
  process.exitCode = 1;
} else {
  var cliUrl = url.pathToFileURL(path.join(__dirname, "..", "src", "index.js")).href;
  var importModule = new Function("specifier", "return import(specifier);");

  importModule(cliUrl).catch(function handleStartupError(error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
