import { useState } from 'react';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { RuleMatchesDialog } from '../RuleMatchesDialog';
import { RulePreview } from '../RulePreview';
import { tokenize } from '../syntax/modsecHighlight';
import { useBuilderView } from '../../context/builderViewContext';
import { useEditorView } from '../../context/editorViewContext';
import { useWorkspace } from '../../context/workspaceContext';
import { useI18n } from '../../i18n/useI18n';
import { lookupTag } from '../../modsec/tags';
import type { TagExclusionSite, TagRuleSite } from '../../modsec/tags';
import '../RuleEditor.css';
import './MarkTip.css';

/**
 * Сколько мест названо карточками, прежде чем остаток — числом.
 *
 * `OWASP_CRS` носят сотни правил CRS: три отвечают на вопрос «кто вообще»,
 * а «+N» и подвал ведут в полное окно исходников.
 */
const SHOWN_SITES = 3;

interface TagMarkProps {
  tag: string;
}

/**
 * Что набор знает о теге: у кого он стоит и кто снимает правила по нему.
 *
 * Тег — вторая запись правила, чей смысл лежит не в нём самом.
 * `tag:'attack-sqli'` не говорит ни того, сколько правил носят тот же
 * ярлык, ни того, снимает ли их `SecRuleRemoveByTag`. Оба ответа — в других
 * строках, часто в файле-надстройке, — поэтому они собраны здесь, на самом
 * чипе, а не в отдельной сводке.
 *
 * Цветом отметка говорит одно: тег стоит только здесь и никто по нему не
 * выбирает правила. Это не ошибка конфигурации — правило загрузится, —
 * просто ярлык ни с кем не связан.
 */
export function TagMark({ tag }: TagMarkProps) {
  const { t } = useI18n();
  const { revealRule } = useBuilderView();
  const { revealLine } = useEditorView();
  const { tags, nameOf } = useWorkspace();
  const [listOpen, setListOpen] = useState(false);

  const entry = lookupTag(tags, tag);
  const rules = entry?.rules ?? [];
  const exclusions = entry?.exclusions ?? [];
  const unnamed = tag === '';
  const lonely = !unnamed && rules.length <= 1 && exclusions.length === 0;
  const ruleIds = uniqueRuleIds(rules);
  const truncatedRules = rules.length > SHOWN_SITES;
  const truncatedExclusions = exclusions.length > SHOWN_SITES;

  const openList = () => {
    if (ruleIds.length > 0) setListOpen(true);
  };

  const ruleCard = (item: TagRuleSite, index: number) => {
    const fileName = nameOf(item.file);
    const lineLabel = String(item.line);
    const tokens = tokenize(item.text);

    return (
      <div key={`${item.file}-${item.key}-${index}`} className="mark-tip__site">
        <div className="mark-tip__where">
          <div className="mark-tip__addr">
            <button
              type="button"
              className="mark-tip__file mark-tip__link"
              aria-label={t('builder.rulePreviewOpenFile', { file: fileName })}
              title={fileName}
              onClick={() => revealLine(1, item.file)}
            >
              {fileName}
            </button>
            <button
              type="button"
              className="mark-tip__line mark-tip__link"
              aria-label={t('builder.rulePreviewOpenLines', { line: lineLabel })}
              onClick={() => revealLine(item.line, item.file)}
            >
              {lineLabel}
            </button>
          </div>
          <RulePreview
            id={item.id}
            file={item.file}
            ruleKey={item.key}
            preText={t('builder.rule')}
            preview={false}
          />
        </div>
        <code className="mark-tip__code" title={item.text}>
          {tokens.map((token, i) => (
            <span key={i} className={`tok-${token.type}`}>
              {token.value}
            </span>
          ))}
        </code>
      </div>
    );
  };

  const exclusionCard = (item: TagExclusionSite, index: number) => {
    const fileName = nameOf(item.file);
    const lineLabel = String(item.line);
    const tokens = tokenize(item.text);

    return (
      <div key={`${item.file}-${item.key}-${item.text}-${index}`} className="mark-tip__site">
        <div className="mark-tip__where">
          <div className="mark-tip__addr">
            <button
              type="button"
              className="mark-tip__file mark-tip__link"
              aria-label={t('builder.rulePreviewOpenFile', { file: fileName })}
              title={fileName}
              onClick={() => revealLine(1, item.file)}
            >
              {fileName}
            </button>
            <button
              type="button"
              className="mark-tip__line mark-tip__link"
              aria-label={t('builder.rulePreviewOpenLines', { line: lineLabel })}
              onClick={() => revealLine(item.line, item.file)}
            >
              {lineLabel}
            </button>
          </div>
          {item.id !== '' ? (
            <RulePreview
              id={item.id}
              file={item.file}
              ruleKey={item.key}
              preText={t('builder.rule')}
              preview={false}
            />
          ) : (
            <Chip
              size="small"
              component="button"
              label={item.name}
              onClick={() => {
                if (item.key !== '') revealRule(item.key, item.file);
                else revealLine(item.line, item.file);
              }}
            />
          )}
        </div>
        <code className="mark-tip__code" title={item.text}>
          {tokens.map((token, i) => (
            <span key={i} className={`tok-${token.type}`}>
              {token.value}
            </span>
          ))}
        </code>
      </div>
    );
  };

  const tip = (
    <div className="mark-tip">
      <div className="mark-tip__name">{unnamed ? t('builder.unset') : tag}</div>
      <div className="mark-tip__note">{t('builder.tagNote')}</div>

      {!unnamed && (
        <>
          <section className="mark-tip__section">
            <div className="mark-tip__head">
              <h4 className="mark-tip__title">{t('builder.tagUsedBy')}</h4>
              {rules.length > 0 && <span className="mark-tip__count">{rules.length}</span>}
            </div>
            {rules.length === 0 ? (
              <div className="mark-tip__empty">{t('builder.tagNeverUsed')}</div>
            ) : (
              <>
                <div className="mark-tip__sites">{rules.slice(0, SHOWN_SITES).map(ruleCard)}</div>
                {truncatedRules && (
                  <button type="button" className="mark-tip__more" onClick={openList}>
                    <span className="mark-tip__more-count">
                      {t('builder.variableMore', { count: String(rules.length - SHOWN_SITES) })}
                    </span>
                    <span className="mark-tip__more-hint">{t('builder.variableBrowseHint')}</span>
                  </button>
                )}
              </>
            )}
          </section>

          <section className="mark-tip__section">
            <div className="mark-tip__head">
              <h4 className="mark-tip__title">{t('builder.tagExcludedBy')}</h4>
              {exclusions.length > 0 && (
                <span className="mark-tip__count">{exclusions.length}</span>
              )}
            </div>
            {exclusions.length === 0 ? (
              <div className="mark-tip__empty">{t('builder.tagNeverExcluded')}</div>
            ) : (
              <>
                <div className="mark-tip__sites">
                  {exclusions.slice(0, SHOWN_SITES).map(exclusionCard)}
                </div>
                {truncatedExclusions && (
                  <div className="mark-tip__more-hint" style={{ marginTop: 4 }}>
                    {t('builder.variableMore', {
                      count: String(exclusions.length - SHOWN_SITES),
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {!unnamed && ruleIds.length > 0 && (
        <div className="mark-tip__footer">
          {(truncatedRules || ruleIds.length > SHOWN_SITES) && (
            <Chip
              size="small"
              component="button"
              label={t('builder.rulePreviewViewAll', { count: String(ruleIds.length) })}
              onClick={openList}
            />
          )}
          <div className="mark-tip__footer-hint">{t('builder.tagIconHint')}</div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Tooltip
        title={tip}
        placement="top"
        disableInteractive={false}
        slotProps={{
          tooltip: {
            sx: { bgcolor: 'transparent', p: 0, maxWidth: 'none' },
          },
        }}
      >
        <IconButton
          size="small"
          aria-label={t('builder.tagInfo')}
          color={lonely ? 'warning' : 'default'}
          // Не давать чипу съесть клик: иначе нажатие на «i» сняло бы тег.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            openList();
          }}
        >
          <InfoOutlinedIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>

      <RuleMatchesDialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        ids={ruleIds}
        heading={tag}
      />
    </>
  );
}

function uniqueRuleIds(sites: TagRuleSite[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const site of sites) {
    if (site.id === '' || seen.has(site.id)) continue;
    seen.add(site.id);
    ids.push(site.id);
  }
  return ids;
}
