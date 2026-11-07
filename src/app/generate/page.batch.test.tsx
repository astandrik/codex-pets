import {renderToStaticMarkup} from 'react-dom/server';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,expect,it,vi} from 'vitest';
import Page from './page';
afterEach(()=>vi.unstubAllEnvs());
it('offers image batches without removing the existing single-character form',()=>{
  vi.stubEnv('PET_GENERATION_ENABLED','true');vi.stubEnv('PET_GENERATION_ENABLE_FILE','');vi.stubEnv('PET_GENERATION_REVIEW_FLOW_ENABLED','true');
  vi.stubEnv('PET_GENERATION_QUEUE_LIMIT','30');vi.stubEnv('PET_GENERATION_DAILY_IP_LIMIT','100');vi.stubEnv('PET_GENERATION_DAILY_GLOBAL_LIMIT','2000');
  const html=renderToStaticMarkup(<ThemeProvider theme="dark"><Page/></ThemeProvider>);
  expect(html).toContain('Пакет изображений');expect(html).toContain('Один питомец');
  expect(html).toContain('Create character');expect(html.match(/<form/g)).toHaveLength(1);
});
