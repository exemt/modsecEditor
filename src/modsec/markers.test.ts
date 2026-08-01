import { compileDocument } from './compile';
import { parseModsec } from './parser';
import { indexWorkspaceMarkerRefs, lookupMarkerRefs } from './markers';
import type { WorkspaceUnit } from './workspace';

function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

describe('indexWorkspaceMarkerRefs', () => {
  it('находит skipAfter на метку', () => {
    const index = indexWorkspaceMarkerRefs([
      unit(
        'rules.conf',
        [
          'SecRule ARGS "@rx x" "id:1001,phase:1,pass,nolog,skipAfter:END"',
          'SecRule ARGS "@rx y" "id:1002,phase:1,deny,nolog"',
          'SecMarker END',
          '',
        ].join('\n'),
      ),
    ]);

    const refs = lookupMarkerRefs(index, 'END');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: '1001',
      line: 1,
      text: 'skipAfter:END',
    });
  });

  it('собирает ссылки из разных файлов', () => {
    const index = indexWorkspaceMarkerRefs([
      unit('setup.conf', 'SecAction "id:1,phase:1,pass,nolog,skipAfter:DONE"\n'),
      unit('rules.conf', 'SecMarker DONE\n'),
    ]);

    const refs = lookupMarkerRefs(index, 'DONE');
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toBe('setup.conf');
  });

  it('не путает регистр имени', () => {
    const index = indexWorkspaceMarkerRefs([
      unit(
        'rules.conf',
        'SecAction "id:1,phase:1,pass,nolog,skipAfter:END"\nSecMarker end\n',
      ),
    ]);

    expect(lookupMarkerRefs(index, 'END')).toHaveLength(1);
    expect(lookupMarkerRefs(index, 'end')).toHaveLength(0);
  });

  it('видит skipAfter в звене цепочки', () => {
    const index = indexWorkspaceMarkerRefs([
      unit(
        'rules.conf',
        [
          'SecRule ARGS "@rx a" "id:1,phase:1,pass,nolog,chain"',
          'SecRule ARGS "@rx b" "skipAfter:TAIL"',
          'SecMarker TAIL',
          '',
        ].join('\n'),
      ),
    ]);

    expect(lookupMarkerRefs(index, 'TAIL')).toHaveLength(1);
    expect(lookupMarkerRefs(index, 'TAIL')[0].id).toBe('1');
  });
});
