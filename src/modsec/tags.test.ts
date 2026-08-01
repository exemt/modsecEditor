import { compileDocument } from './compile';
import { indexWorkspaceExclusions } from './exclusions';
import { parseModsec } from './parser';
import { indexWorkspaceTags, lookupTag } from './tags';
import type { WorkspaceUnit } from './workspace';

function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

function index(...sources: [string, string][]) {
  const units = sources.map(([name, source]) => unit(name, source));
  return indexWorkspaceTags(units, indexWorkspaceExclusions(units));
}

describe('indexWorkspaceTags', () => {
  it('находит правила с одним тегом', () => {
    const found = lookupTag(
      index([
        'rules.conf',
        [
          'SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:\'OWASP_CRS\'"',
          'SecRule ARGS "@rx b" "id:2,phase:2,deny,tag:\'OWASP_CRS\'"',
          '',
        ].join('\n'),
      ]),
      'OWASP_CRS',
    );

    expect(found?.rules.map((rule) => rule.id)).toEqual(['1', '2']);
    expect(found?.rules[0].text).toBe("tag:'OWASP_CRS'");
  });

  it('находит исключение, снимающее по тегу', () => {
    const found = lookupTag(
      index([
        'rules.conf',
        [
          'SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:\'attack-sqli\'"',
          'SecRuleRemoveByTag attack-sqli',
          '',
        ].join('\n'),
      ]),
      'attack-sqli',
    );

    expect(found?.exclusions).toHaveLength(1);
    expect(found?.exclusions[0].name).toBe('SecRuleRemoveByTag');
    expect(found?.exclusions[0].text).toContain('attack-sqli');
  });

  it('видит ctl-исключение по тегу', () => {
    const found = lookupTag(
      index([
        'rules.conf',
        [
          'SecRule REQUEST_URI "@beginsWith /api" "id:10,phase:1,pass,nolog,ctl:ruleRemoveByTag=OWASP_CRS"',
          'SecRule ARGS "@rx a" "id:20,phase:2,deny,tag:\'OWASP_CRS\'"',
          '',
        ].join('\n'),
      ]),
      'OWASP_CRS',
    );

    expect(found?.exclusions).toHaveLength(1);
    expect(found?.exclusions[0].source).toBe('ctl');
    expect(found?.exclusions[0].id).toBe('10');
  });

  it('не путает разные теги', () => {
    const tags = index([
      'rules.conf',
      [
        'SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:\'attack-sqli\'"',
        'SecRule ARGS "@rx b" "id:2,phase:2,deny,tag:\'attack-xss\'"',
        'SecRuleRemoveByTag attack-sqli',
        '',
      ].join('\n'),
    ]);

    expect(lookupTag(tags, 'attack-sqli')?.exclusions).toHaveLength(1);
    expect(lookupTag(tags, 'attack-xss')?.exclusions).toHaveLength(0);
  });
});
