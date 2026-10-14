import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPetAnnotationCandidates, getPetCaptionCandidates, listPetAnnotationsWithSources, listPetCaptionsWithSources } from "@/lib/pets/metadata-records";
import { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION } from "@/lib/pets/metadata-sources";
import { RELATED_PETS_ANNOTATION_REVISION } from "@/lib/pets/related-pets-annotation-contract.mjs";
import { PET_VISION_CAPTION_REVISION } from "@/lib/pets/search-vision-contract";
const mocks=vi.hoisted(()=>({annotationGet:vi.fn(),annotationList:vi.fn(),captionGet:vi.fn(),captionList:vi.fn()}));
vi.mock("@/lib/pets/related-pets-annotations-repository",()=>({getRelatedPetAnnotation:mocks.annotationGet,listRelatedPetAnnotations:mocks.annotationList}));
vi.mock("@/lib/pets/search-captions-repository",()=>({getPetSearchCaption:mocks.captionGet,listPetSearchCaptions:mocks.captionList}));
beforeEach(()=>vi.resetAllMocks());
describe("additive source selection",()=>{
  it("returns physical candidates without deciding freshness",async()=>{
    mocks.annotationGet.mockResolvedValue({slug:"old",sourceHash:"unchanged"});
    mocks.captionGet.mockResolvedValue({slug:"old",sourceHash:"unchanged"});
    expect(await getPetAnnotationCandidates(RELATED_PETS_ANNOTATION_REVISION,"old")).toMatchObject([{annotationRevision:RELATED_PETS_ANNOTATION_REVISION,sourceHash:"unchanged"},{annotationRevision:OPENAI_ANNOTATION_REVISION}]);
    expect(await getPetCaptionCandidates(PET_VISION_CAPTION_REVISION,"old")).toMatchObject([{captionRevision:PET_VISION_CAPTION_REVISION,sourceHash:"unchanged"},{captionRevision:OPENAI_CAPTION_REVISION}]);
    expect(mocks.annotationGet).toHaveBeenCalledTimes(2);expect(mocks.captionGet).toHaveBeenCalledTimes(2);
  });
  it("reads the alternative only when the legacy record is absent and returns actual source revision",async()=>{
    mocks.annotationGet.mockResolvedValueOnce(null).mockResolvedValueOnce({slug:"lumi",sourceHash:"new"});
    mocks.captionGet.mockResolvedValueOnce(null).mockResolvedValueOnce({slug:"lumi",sourceHash:"new"});
    expect(await getPetAnnotationCandidates(RELATED_PETS_ANNOTATION_REVISION,"lumi")).toMatchObject([{annotationRevision:OPENAI_ANNOTATION_REVISION}]);
    expect(await getPetCaptionCandidates(PET_VISION_CAPTION_REVISION,"lumi")).toMatchObject([{captionRevision:OPENAI_CAPTION_REVISION}]);
  });
  it("keeps duplicate-source candidates so freshness can be evaluated later",async()=>{
    mocks.annotationList.mockResolvedValueOnce([{slug:"old",sourceHash:"old"}]).mockResolvedValueOnce([{slug:"old",sourceHash:"replacement"},{slug:"lumi",sourceHash:"new"}]);
    mocks.captionList.mockResolvedValueOnce([{slug:"old",sourceHash:"old"}]).mockResolvedValueOnce([{slug:"old",sourceHash:"replacement"},{slug:"lumi",sourceHash:"new"}]);
    const annotations=await listPetAnnotationsWithSources(RELATED_PETS_ANNOTATION_REVISION);const captions=await listPetCaptionsWithSources(PET_VISION_CAPTION_REVISION);
    expect(annotations.map(row=>row.sourceHash)).toEqual(["old","replacement","new"]);expect(captions.map(row=>row.sourceHash)).toEqual(["old","replacement","new"]);
    expect(annotations[2].annotationRevision).toBe(OPENAI_ANNOTATION_REVISION);expect(captions[2].captionRevision).toBe(OPENAI_CAPTION_REVISION);
  });
});
