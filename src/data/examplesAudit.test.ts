import { parseModsec } from '../modsec/parser';
import { compileDocument } from '../modsec/compile';
import { modsecExamples } from './modsecExamples';

it('dumps diagnostics for every example', () => {
  const lines: string[] = [];
  for (const example of modsecExamples) {
    const compiled = compileDocument(parseModsec(example.code));
    lines.push(
      `${example.section}/${example.id}: ${compiled.diagnostics
        .map((d) => `${d.severity[0]}:${d.code}@${d.line ?? '?'}`)
        .join(' ') || 'clean'}`,
    );
  }
  console.log(lines.join('\n'));
});
