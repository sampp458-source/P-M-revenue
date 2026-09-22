import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const stripHooks = (source: string) => source
  .replace('import "../design-system-v2.css";\n', '')
  .replace('import "../catalog-design-v2.css";\n', '')
  .replace(' pm-design-v2 pm-catalog-v2', '')
  .replace('import "../admin-directory-design-v1.css";\n', '')
  .replace(/ data-label="(?:연결 상품|휴대폰|Finance 역할|운영 권한|가입일|승인일|퇴사일)"/g, '')
  .replace(/className="([^"]*)"/g, (_, classes: string) => {
    const original = classes.split(' ').filter(name => !/^(?:admin-directory-table|category-(?:name|linked|status|actions)|staff-(?:name|email|phone|finance|operation|status|date|actions))$/.test(name)).join(' ');
    return original ? `className="${original}"` : '';
  }).replace(/<(td|Table) >/g, '<$1>');

describe('Admin directory visual contract', () => {
  it('preserves category CRUD, linked-product restrictions and all non-category pages byte-for-byte', () => {
    const source = stripHooks(readFileSync('src/pages/Management.tsx', 'utf8'))
      .replace('<section className="pm-design-v1 pm-admin-directory-v1 pm-categories-v1">', '<>')
      .replace('    </section>\n  );', '    </>\n  );');
    expect(hash(source)).toBe('31b3fee8d937a3ffcc1e9b88e7ecb35a240ddf1dec98255148c7f3f9cc5f6937');
  });
  it('preserves every staff permission branch, handler, query, payload and modal', () => {
    const source = stripHooks(readFileSync('src/pages/StaffManagement.tsx', 'utf8').replace(/import ["'].*(?:admin|settings|access)-design-v2\.css["'];\n/g, '').replace(/ pm-(?:admin|settings|access)-v2/g, ''))
      .replace('<section className="pm-design-v1 pm-admin-directory-v1 pm-staff-v1">', '<>')
      .replace('  </section>;', '  </>;');
    expect(hash(source)).toBe('6adace84b29e91cbb351454a022b46a7bc440f8284839b550ba8170c3a425b0f');
  });
  it('scopes every style to opted-in directory screens', () => {
    const css = readFileSync('src/admin-directory-design-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{}]*\{/g, '');
    for (const [, selectors] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(/,(?![^()]*\))/)) expect(selector.trim()).toMatch(/^\.pm-design-v1\.pm-(admin-directory|categories|staff)-v1\b/);
    }
  });
});
