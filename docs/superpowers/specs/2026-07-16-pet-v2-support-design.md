# Codex Pet v2 registry support

## Goal

Accept and present both Codex pet atlas formats without changing the YDB schema
or the public submission API.

- v1 is the default when `spriteVersionNumber` is absent or equals `1`; its
  atlas is 8x9 cells at 1536x1872.
- v2 requires `spriteVersionNumber: 2`; its atlas is 8x11 cells at 1536x2288.
- Any other version or a version/dimension mismatch is rejected.

## Validation and upload

The shared pet contract owns the supported version and atlas mappings. Both the
browser upload preparation and `validateUploadedPackage` use the same mapping,
so client and server reject the same invalid packages. The server remains the
authoritative boundary and stores the original accepted `pet.json`, spritesheet,
and ZIP bytes unchanged.

`PetJson` gains an optional `spriteVersionNumber: 1 | 2`. An omitted version is
preserved as omitted but resolved to v1 whenever atlas behavior is selected.
Unsupported versions return `invalid_sprite_version` on the
`spriteVersionNumber` field.

## Gallery preview

The pet detail page gives `StatePreview` both public asset URLs. The component
loads the untrusted `pet.json`, accepts only versions 1 and 2, and verifies the
choice against the spritesheet's natural dimensions. If metadata cannot be
loaded, an exact known spritesheet dimension can safely recover the display
version; other shapes fail closed to the existing v1 controls.

For v2, the existing nine standard animation controls remain unchanged and a
`Look directions` control exposes the 16 clockwise cells. Direction indices
0-7 map to row 9 and indices 8-15 map to row 10. The mode plays the complete
loop, displays the current degree/direction label, and provides 16 direct
selectors for inspecting individual cells. Selecting a direction pauses the
loop; selecting `Look directions` again resumes it.

## Compatibility and rollout

No YDB column, `PublicPet` field, manifest shape, or submission route field is
added. Existing v1 packages and detail pages retain their current behavior.
Public documentation describes both accepted layouts. Production deployment
and retrying the Rose Katana submission require a separate explicit approval.

## Verification

Test first at the shared-contract, package, route, and direction-cell mapping
boundaries. Then run the complete unit suite, lint, TypeScript check, production
build, and a visible local browser check for v1 upload behavior and the Rose
Katana v2 preview.
