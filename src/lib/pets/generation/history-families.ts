export type HistoryVersionKind = 'initial' | 'base-refinement' | 'base-retry' | 'continuation' | 'animation-revision';
export type HistoryVersionIdentity = {
  generationId: string;
  savedAt: number;
  createdAt?: number;
  familyId?: string;
  parentGenerationId?: string;
};
export function versionTime(version: HistoryVersionIdentity): number {
  return version.createdAt ?? version.savedAt;
}
export function compareVersions(a: HistoryVersionIdentity, b: HistoryVersionIdentity): number {
  return versionTime(b) - versionTime(a) || a.generationId.localeCompare(b.generationId);
}

// Missing ancestors retain the root saved when the operation was accepted.
// A cycle must not collapse unrelated capabilities into one visible row.
export function groupGenerationVersions<T extends HistoryVersionIdentity>(versions: T[]): Array<{familyId: string; versions: T[]}> {
  const byId = new Map(versions.map(version => [version.generationId, version]));
  const roots = new Map<string, string | null>();
  function root(id: string): string | null {
    const path: string[] = [], visited = new Set<string>();
    let current = id, result: string | null;
    for (;;) {
      if (roots.has(current)) {result = roots.get(current)!; break;}
      if (visited.has(current)) {result = null; break;}
      visited.add(current); path.push(current);
      const version = byId.get(current);
      if (!version) {result = current; break;}
      const parent = version.parentGenerationId;
      if (!parent || !byId.has(parent)) {result = version.familyId ?? parent ?? current; break;}
      current = parent;
    }
    for (const member of path) roots.set(member, result);
    return result;
  }
  const groups = new Map<string, T[]>();
  for (const version of versions) {
    const familyId = root(version.generationId) ?? version.generationId;
    const members = groups.get(familyId) ?? [];
    members.push(version);
    groups.set(familyId, members);
  }
  return [...groups].map(([familyId, members]) => ({familyId, versions: orderFamilyVersions(members)}))
    .sort((a, b) => compareVersions(a.versions[0], b.versions[0]));
}

// Bound an ancestor's fallback time by its descendants before sorting. This
// keeps the comparator transitive, including when parallel branches coexist.
function orderFamilyVersions<T extends HistoryVersionIdentity>(versions:T[]):T[] {
  const byId=new Map(versions.map(version=>[version.generationId,version]));
  const keys=new Map(versions.map(version=>[version.generationId,{time:versionTime(version),depth:0}]));
  const childCounts=new Map(versions.map(version=>[version.generationId,0]));
  for(const version of versions){
    if(version.parentGenerationId&&byId.has(version.parentGenerationId))childCounts.set(version.parentGenerationId,childCounts.get(version.parentGenerationId)!+1);
  }
  const ready=versions.filter(version=>childCounts.get(version.generationId)===0);
  let processed=0;
  while(ready.length){
    const child=ready.pop()!,parent=byId.get(child.parentGenerationId??'');
    processed++;
    if(!parent)continue;
    const childKey=keys.get(child.generationId)!,parentKey=keys.get(parent.generationId)!;
    parentKey.time=Math.min(parentKey.time,childKey.time);
    parentKey.depth=Math.max(parentKey.depth,childKey.depth+1);
    const remaining=childCounts.get(parent.generationId)!-1;
    childCounts.set(parent.generationId,remaining);
    if(!remaining)ready.push(parent);
  }
  if(processed!==versions.length)return versions.sort(compareVersions);
  return versions.sort((a,b)=>{
    const left=keys.get(a.generationId)!,right=keys.get(b.generationId)!;
    return right.time-left.time||left.depth-right.depth||a.generationId.localeCompare(b.generationId);
  });
}
