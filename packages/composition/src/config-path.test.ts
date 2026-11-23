import { describe, expect, it } from 'vitest';
import { defaultConfigPath } from './config-path';

describe('defaultConfigPath', () => {
  it('prefers JARVIS_CONFIG, then INIT_CWD, then cwd', () => {
    expect(defaultConfigPath({ JARVIS_CONFIG: '/x/c.yaml', INIT_CWD: '/i' }, '/w')).toBe('/x/c.yaml');
    expect(defaultConfigPath({ INIT_CWD: '/i' }, '/w')).toBe('/i/jarvis.config.yaml');
    expect(defaultConfigPath({}, '/w')).toBe('/w/jarvis.config.yaml');
  });
});
