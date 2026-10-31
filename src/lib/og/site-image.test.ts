import sharp from 'sharp';
import {it,expect} from 'vitest';
import {renderSiteOgImage} from './site-image';
it('renders a decodable 1200x630 site preview',async()=>{
 const response=renderSiteOgImage();const bytes=Buffer.from(await response.arrayBuffer());const meta=await sharp(bytes).metadata();expect(meta).toMatchObject({format:'png',width:1200,height:630});
});
