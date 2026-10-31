// @vitest-environment jsdom
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {HomePage} from './HomePage';
import {buildCatalogPageMetadata} from '@/lib/site-metadata';
function page(extra={}) {return renderToStaticMarkup(HomePage({pets:[],totalPets:0,catalogTotalPets:0,showLandingContent:true,catalog:<div>catalog-marker</div>,...extra}));}
describe('creation-first homepage contract',()=>{
 it('leads with creation and leaves help after the same full catalog',()=>{
  const html=page();expect(html).toContain('Create your own animated pet for Codex');expect(html).toContain('Create your pet');
  expect(html.indexOf('catalog-marker')).toBeLessThan(html.indexOf('Before you create'));expect(html).not.toContain('/generated/');
 });
 it('uses disabled and text-only availability without promising image input',()=>{
  const html=page({generationAvailable:false,reviewBase:false});expect(html).toContain('Generation unavailable');expect(html).not.toContain('paste an image');expect(html).not.toContain('Can I start from an image?');
 });
 it('uses creation metadata for the root while retaining catalog page metadata',()=>{
  const f={query:'',kind:'all' as const,tags:[]};const home=buildCatalogPageMetadata(f,1,false);expect(home.description).toContain('from text or an image');
  expect(buildCatalogPageMetadata(f,2,false).alternates?.canonical).toContain('page=2');
 });
});

it('does not repeat landing sections on later catalog pages', () => {
  const html=page({showLandingContent:false});
  expect(html).not.toContain('Create your own animated pet for Codex');
  expect(html).not.toContain('Before you create');
  expect(html).not.toContain('Copy prompt');
  expect(html).toContain('catalog-marker');
});
