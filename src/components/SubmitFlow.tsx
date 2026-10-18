'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './map/MapView';
import PlacePicker, { type AddressList } from './PlacePicker';
import RoadviewPane from './RoadviewPane';
import { useI18n } from './I18nProvider';
import { useReducedMotion } from '@/lib/client/useReducedMotion';
import { CATEGORY_KEYS, CATEGORY_ORDER } from '@/lib/client/categories';
import { clearReceipt, setReceipt } from '@/lib/client/receipt';
import { cellKey, GRID_VERSION, quantize, representative } from '@/lib/domain/grid';
import { textLengths } from '@/lib/domain/validation';
import type { Category, Language, PublicConfig } from '@/lib/domain/types';
import type { MessageKey } from '@/lib/i18n/messages';
import { mapProvider } from '@/lib/map/provider';
import { loadKakao, type Kakao } from '@/lib/map/kakao';
import { nearbyAddresses, searchAddresses, type AddressItem } from '@/lib/map/kakaoPlaces';

type Draft = { category: Category | ''; language: Language | ''; text: string; allowMap: boolean; allowPlayer: boolean };
type FieldErrors = Partial<Record<'category' | 'language' | 'text' | 'location', MessageKey>>;
type Cell = { cell_x: number; cell_y: number };
// 카카오 지도일 때만: 주소 목록 → 로드뷰 → 핀 → 의견. 저장은 칸 번호만.
type Place = { stage: 'list' } | { stage: 'view'; item: AddressItem } | { stage: 'pinned'; item: AddressItem } | { stage: 'skipped' };

const EMPTY: Draft = { category: '', language: '', text: '', allowMap: false, allowPlayer: false };
const TIMEOUT_MS = 10_000;

export default function SubmitFlow() {
  const { t } = useI18n();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const provider = useMemo(() => mapProvider(), []);
  const [config, setConfig] = useState<{ status: 'loading' | 'ready' | 'error'; data?: PublicConfig }>({ status: 'loading' });
  const [cell, setCell] = useState<Cell | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [locationNotice, setLocationNotice] = useState<MessageKey | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  // 등록 성공 후 완료 화면으로 바뀌기 전까지 다시 제출하지 못하게 잠근다(요청 키도 유지).
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<MessageKey | null>(null);
  const [tileStatus, setTileStatus] = useState<'ok' | 'failed' | 'unknown'>('unknown');
  const [reloadToken, setReloadToken] = useState(0);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelWasOpen = useRef<'none' | 'picker' | 'form'>('none');
  const mapFrameRef = useRef<HTMLDivElement>(null);
  const [kakao, setKakao] = useState<Kakao | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [addrList, setAddrList] = useState<AddressList>({ status: 'ready', items: [] });
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number; token: number } | null>(null);
  const lookup = useRef(0);

  useEffect(() => {
    if (provider?.kind !== 'kakao') return;
    let cancelled = false;
    loadKakao(provider.appKey, provider.sdkUrl).then((k) => { if (!cancelled) setKakao(k); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [provider]);

  const loadConfig = useCallback(async () => {
    setConfig((c) => ({ status: 'loading', data: c.data }));
    // 허용 영역이 넓으면 응답이 커서 첫 요청이 실패할 수 있다. 두 번까지 조용히 다시 시도한다.
    for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
      try {
        const res = await fetch('/api/public/config', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        setConfig({ status: 'ready', data: (await res.json()) as PublicConfig });
        return;
      } catch {
        if (attemptNo < 2) await new Promise((r) => setTimeout(r, 800 * (attemptNo + 1)));
      }
    }
    setConfig({ status: 'error' });
  }, []);
  useEffect(() => {
    clearReceipt();
    void loadConfig();
  }, [loadConfig]);

  const allowed = useMemo(() => new Set((config.data?.allowed_cells ?? []).map((c) => cellKey(c.cell_x, c.cell_y))), [config.data]);
  const open = config.status === 'ready' && !!config.data?.submissions_enabled && allowed.size > 0;
  const placeMode = kakao !== null;
  const placeDone = !placeMode || place?.stage === 'pinned' || place?.stage === 'skipped';
  const pickerOpen = open && cell !== null && !choosing && placeMode && !placeDone;
  const panelOpen = open && cell !== null && !choosing && placeDone;
  const placeItem = place && (place.stage === 'view' || place.stage === 'pinned') ? place.item : null;
  const areaRect = useMemo(() => {
    const cells = config.data?.allowed_cells ?? [];
    if (cells.length === 0) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cells) { minX = Math.min(minX, c.cell_x); minY = Math.min(minY, c.cell_y); maxX = Math.max(maxX, c.cell_x); maxY = Math.max(maxY, c.cell_y); }
    const sw = representative({ grid_version: GRID_VERSION, cell_x: minX, cell_y: minY });
    const ne = representative({ grid_version: GRID_VERSION, cell_x: maxX, cell_y: maxY });
    return `${sw.lon},${sw.lat},${ne.lon},${ne.lat}`;
  }, [config.data]);
  const itemAllowed = useCallback((it: AddressItem) => {
    try { const q = quantize(it.lat, it.lon); return allowed.has(cellKey(q.cell_x, q.cell_y)); } catch { return false; }
  }, [allowed]);

  useEffect(() => {
    const now = panelOpen ? 'form' : pickerOpen ? 'picker' : 'none';
    if (now !== 'none' && now !== panelWasOpen.current) {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    panelWasOpen.current = now;
  }, [panelOpen, pickerOpen, reducedMotion]);

  // 지도 클릭·Enter: 원좌표는 이 함수 안에서만 쓰고 격자 번호만 남긴다.
  const onPick = useCallback((lat: number, lon: number) => {
    if (!open || submitting || done) return;
    let picked: Cell;
    try {
      const q = quantize(lat, lon);
      picked = { cell_x: q.cell_x, cell_y: q.cell_y };
    } catch {
      setLocationNotice('err.location');
      return;
    }
    if (!allowed.has(cellKey(picked.cell_x, picked.cell_y))) {
      setLocationNotice('submit.outside');
      return;
    }
    setCell(picked);
    setChoosing(false);
    setLocationNotice(null);
    setErrors((e) => ({ ...e, location: undefined }));
    if (kakao) {
      // 주변 주소는 카카오에 직접 묻는다. 누른 좌표는 이 요청에만 쓰고 우리 서버로 보내지 않는다.
      panelWasOpen.current = 'none';
      setPlace({ stage: 'list' });
      setQuery('');
      setAddrList({ status: 'loading', items: [] });
      const id = ++lookup.current;
      nearbyAddresses(kakao, lat, lon)
        .then((items) => { if (lookup.current === id) setAddrList({ status: 'ready', items }); })
        .catch(() => { if (lookup.current === id) setAddrList({ status: 'error', items: [] }); });
    }
  }, [allowed, open, submitting, done, kakao]);

  const runSearch = useCallback(() => {
    if (!kakao || !query.trim()) return;
    const id = ++lookup.current;
    setAddrList((l) => ({ status: 'loading', items: l.items }));
    searchAddresses(kakao, query, areaRect)
      .then((items) => { if (lookup.current === id) setAddrList({ status: 'ready', items }); })
      .catch(() => { if (lookup.current === id) setAddrList({ status: 'error', items: [] }); });
  }, [kakao, query, areaRect]);

  const selectItem = useCallback((it: AddressItem) => {
    let q;
    try { q = quantize(it.lat, it.lon); } catch { return; }
    if (!allowed.has(cellKey(q.cell_x, q.cell_y))) { setLocationNotice('submit.outside'); return; }
    setCell({ cell_x: q.cell_x, cell_y: q.cell_y });
    setLocationNotice(null);
    setPlace({ stage: 'view', item: it });
    setFocus((f) => ({ lat: it.lat, lon: it.lon, zoom: 17, token: (f?.token ?? 0) + 1 }));
    // 좁은 화면에서는 지도·로드뷰가 목록 위에 있으므로 로드뷰가 보이게 올린다.
    if (window.matchMedia('(max-width: 860px)').matches) {
      requestAnimationFrame(() => mapFrameRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' }));
    }
  }, [allowed, reducedMotion]);

  const tag = useMemo(() => {
    if (!cell) return null;
    const p = representative({ grid_version: GRID_VERSION, ...cell });
    return { lat: p.lat, lon: p.lon, label: t('panel.location') };
  }, [cell, t]);

  const lengths = textLengths(draft.text);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'allowMap' && !value) next.allowPlayer = false;
      return next;
    });
    setSubmitError(null);
    const errKey = key === 'text' ? 'text' : key === 'category' ? 'category' : key === 'language' ? 'language' : null;
    if (errKey) setErrors((e) => ({ ...e, [errKey]: undefined }));
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!draft.category) e.category = 'err.category';
    if (!draft.language) e.language = 'err.language';
    if (lengths.nonspace < 10) e.text = 'err.short';
    else if (lengths.total > 500) e.text = 'err.long';
    if (!cell) e.location = 'err.location';
    return e;
  }

  function focusFirst(e: FieldErrors) {
    const id = e.location ? 'change-location' : e.category ? 'f-category' : e.language ? 'f-language' : e.text ? 'f-text' : null;
    if (id) document.getElementById(id)?.focus();
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting || done || !config.data || !cell) return;
    const e = validate();
    setErrors(e);
    if (Object.values(e).some(Boolean)) { setSubmitError('panel.fixErrors'); focusFirst(e); return; }
    const payload = JSON.stringify({
      grid_version: GRID_VERSION,
      cell_x: cell.cell_x,
      cell_y: cell.cell_y,
      category: draft.category,
      language: draft.language,
      original_text: draft.text,
      allow_map: draft.allowMap,
      allow_player: draft.allowMap && draft.allowPlayer,
      notice_version: config.data.notice_version,
    });
    // 같은 내용의 재시도는 같은 요청 키, 내용이 바뀌면 새 키.
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    const { key } = attempt.current;
    setSubmitting(true);
    setSubmitError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('/api/opinions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: payload,
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      if (res.status === 201 || res.status === 200) {
        if (!body || typeof body.reference !== 'string') throw new Error('shape');
        setDone(true);
        setReceipt({ reference: body.reference, published: body.published === true, player: draft.allowMap && draft.allowPlayer });
        router.push('/submit/complete');
        return;
      }
      const code: string = body?.error?.code ?? '';
      if (code === 'TEXT_TOO_SHORT') setErrors((x) => ({ ...x, text: 'err.short' }));
      else if (code === 'TEXT_TOO_LONG') setErrors((x) => ({ ...x, text: 'err.long' }));
      else if (code === 'INVALID_CATEGORY') setErrors((x) => ({ ...x, category: 'err.category' }));
      else if (code === 'INVALID_LANGUAGE') setErrors((x) => ({ ...x, language: 'err.language' }));
      else if (code === 'OUTSIDE_AREA' || code === 'INVALID_GRID' || code === 'INVALID_CELL') {
        setErrors((x) => ({ ...x, location: 'submit.outside' }));
        void loadConfig();
      }
      if (res.status === 429) setSubmitError('err.rate');
      else if (code === 'INVALID_NOTICE') { setSubmitError('err.notice'); void loadConfig(); }
      else if (code === 'SUBMISSIONS_DISABLED') { setSubmitError('err.server'); void loadConfig(); }
      else if (res.status === 409) { attempt.current = null; setSubmitError('err.server'); }
      else if (res.status === 422 || res.status === 400) setSubmitError('panel.fixErrors');
      else setSubmitError('err.server');
    } catch {
      // 응답 유실·시간 초과: 같은 키로 다시 시도할 수 있도록 attempt를 유지한다.
      setSubmitError('err.network');
    } finally {
      clearTimeout(timer);
      setSubmitting(false);
    }
  }

  const describe = (id: string, err?: MessageKey) => (err ? `${id}-help ${id}-err` : `${id}-help`);

  return (
    <div className="explorer explorer--submit">
      <section className="card map-card" aria-label={t('map.ariaSubmit')}>
        <div className="map-frame map-frame--tall" ref={mapFrameRef}>
          <MapView
            provider={provider}
            ariaLabel={t('map.ariaSubmit')}
            allowedCells={open ? config.data?.allowed_cells : []}
            tag={tag}
            onPick={onPick}
            fit="allowed"
            focus={focus}
            reducedMotion={reducedMotion}
            onTileStatus={setTileStatus}
            reloadToken={reloadToken}
          />
          {kakao && placeItem && cell && !choosing ? (
            <RoadviewPane
              kakao={kakao}
              item={placeItem}
              pinned={place?.stage === 'pinned'}
              onPin={() => setPlace({ stage: 'pinned', item: placeItem })}
              onBack={() => setPlace({ stage: 'list' })}
            />
          ) : null}
          {open ? (
            <div className={`map-instruction${locationNotice ? ' map-instruction--error' : ''}`} role={locationNotice ? 'alert' : 'status'}>
              {locationNotice ? t(locationNotice) : choosing ? t('submit.reselect') : !cell ? t('submit.instruction') : t('submit.picked')}
              {choosing ? <button type="button" className="link-btn" onClick={() => { setChoosing(false); setLocationNotice(null); }}>{t('submit.cancelReselect')}</button> : null}
            </div>
          ) : null}
          {provider?.dev ? <span className="map-note">{t('devMap')}</span> : null}
          {(!provider || tileStatus === 'failed') ? (
            <div className="map-alert" role="status">
              <strong>{t('mapError.title')}</strong>
              <span>{t('mapError.submitBody')}</span>
              {provider ? <button type="button" className="btn btn--small" onClick={() => { setTileStatus('unknown'); setReloadToken((n) => n + 1); }}>{t('mapError.retry')}</button> : null}
            </div>
          ) : null}
        </div>
        <div className="map-foot">
          <span><span className="legend-swatch" aria-hidden="true" /> {t('submit.areaLegend')}</span>
          <span className="muted">{t('map.keyboardHint')}</span>
        </div>
      </section>

      <aside className="card side-panel submit-panel" aria-labelledby="panel-heading">
        <ol className="steps">
          <li className={cell ? 'done' : 'current'}><span>1</span> {t('panel.step1')}</li>
          {placeMode ? <li className={pickerOpen ? 'current' : panelOpen ? 'done' : ''}><span>2</span> {t('place.step')}</li> : null}
          <li className={panelOpen ? 'current' : ''}><span>{placeMode ? 3 : 2}</span> {t('panel.step2')}</li>
        </ol>
        {config.status === 'loading' && !config.data ? <p className="state" role="status" aria-busy="true">…</p> : null}
        {config.status === 'error' ? (
          <div className="state state--error" role="alert">
            <p>{t('submit.configError')}</p>
            <button type="button" className="btn btn--small" onClick={() => void loadConfig()}>{t('state.retry')}</button>
          </div>
        ) : null}
        {config.status === 'ready' && !open ? (
          <div className="state state--warn" role="status">
            <p><strong>{t('submit.closed')}</strong></p>
            <p>{t('submit.closedBody')}</p>
            <Link href="/map" className="btn btn--small">{t('complete.toMap')}</Link>
          </div>
        ) : null}
        {pickerOpen ? (
          <PlacePicker
            list={addrList}
            query={query}
            onQuery={setQuery}
            onSearch={runSearch}
            onSelect={selectItem}
            onSkip={() => setPlace({ stage: 'skipped' })}
            isAllowed={itemAllowed}
            selectedId={placeItem?.id ?? null}
            headingRef={headingRef}
          />
        ) : null}
        {open && !panelOpen && !pickerOpen ? (
          <div className="panel-placeholder">
            <h2 id="panel-heading" tabIndex={-1} ref={headingRef}>{choosing ? t('submit.reselect') : t('submit.instruction')}</h2>
            <p className="muted">{t('submit.privacyPlace')}</p>
          </div>
        ) : null}
        {panelOpen ? (
          <form onSubmit={submit} noValidate aria-busy={submitting}>
            <h2 id="panel-heading" tabIndex={-1} ref={headingRef}>{t('panel.heading')}</h2>
            <div className={`location-box${errors.location ? ' location-box--error' : ''}`}>
              <span className="location-box__icon" aria-hidden="true">⌖</span>
              <span className="location-box__text">
                <strong>{placeItem ? (placeItem.name ?? placeItem.road ?? placeItem.jibun) : t('panel.location')}</strong>
                <span className="muted">{placeItem ? t('place.savedNote') : t('panel.locationHelp')}</span>
                {errors.location ? <span className="field-error" role="alert">{t(errors.location)}</span> : null}
              </span>
              <button id="change-location" type="button" className="link-btn" onClick={() => { setChoosing(true); setPlace(null); setLocationNotice(null); }} disabled={submitting}>{t('panel.change')}</button>
            </div>
            <p className="hint">{t('submit.privacyPlace')}</p>

            <div className="field-row">
              <div className="field">
                <label htmlFor="f-category">{t('panel.category')}</label>
                <select id="f-category" value={draft.category} onChange={(e) => update('category', e.target.value as Category)} aria-invalid={!!errors.category} aria-describedby={errors.category ? 'f-category-err' : undefined} required>
                  <option value="">{t('panel.choose')}</option>
                  {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{t(CATEGORY_KEYS[c])}</option>)}
                </select>
                {errors.category ? <span id="f-category-err" className="field-error">{t(errors.category)}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="f-language">{t('panel.language')}</label>
                <select id="f-language" value={draft.language} onChange={(e) => update('language', e.target.value as Language)} aria-invalid={!!errors.language} aria-describedby={errors.language ? 'f-language-err' : undefined} required>
                  <option value="">{t('panel.choose')}</option>
                  <option value="ko">{t('lang.ko')}</option>
                  <option value="en">{t('lang.en')}</option>
                  <option value="other">{t('lang.other')}</option>
                </select>
                {errors.language ? <span id="f-language-err" className="field-error">{t(errors.language)}</span> : null}
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-text">{t('panel.opinion')}</label>
              <textarea id="f-text" rows={5} value={draft.text} onChange={(e) => update('text', e.target.value)} aria-invalid={!!errors.text} aria-describedby={describe('f-text', errors.text)} required />
              <div className="field-foot">
                <span id="f-text-help" className="muted">{t('panel.opinionHelp')}</span>
                <span className={lengths.total > 500 ? 'counter counter--over' : 'counter'} aria-live="polite">{t('panel.counter', { n: lengths.total })}</span>
              </div>
              {errors.text ? <span id="f-text-err" className="field-error">{t(errors.text)}</span> : null}
              <p className="hint hint--warn">{t('panel.privacy')}</p>
            </div>

            <fieldset className="consent">
              <legend>{t('panel.consentLead')}</legend>
              <div className="check">
                <input id="f-map" type="checkbox" checked={draft.allowMap} onChange={(e) => update('allowMap', e.target.checked)} aria-describedby="f-map-help" />
                <label htmlFor="f-map">{t('panel.allowMap')}</label>
                <span id="f-map-help" className="muted">{t('panel.allowMapHelp')}</span>
              </div>
              <div className={`check${draft.allowMap ? '' : ' check--disabled'}`}>
                <input id="f-player" type="checkbox" checked={draft.allowPlayer} disabled={!draft.allowMap} onChange={(e) => update('allowPlayer', e.target.checked)} aria-describedby="f-player-help" />
                <label htmlFor="f-player">{t('panel.allowPlayer')}</label>
                <span id="f-player-help" className="muted">{t('panel.allowPlayerHelp')}</span>
              </div>
            </fieldset>

            {config.data?.test_auto_publish ? <p className="state state--warn small" role="note">{t('submit.testMode')}</p> : null}
            {submitError ? <p className="state state--error" role="alert">{t(submitError)}</p> : null}
            <button type="submit" className="btn btn--primary btn--block" disabled={submitting || done}>
              {submitting || done ? t('panel.submitting') : t('panel.submit')} <span aria-hidden="true">→</span>
            </button>
          </form>
        ) : null}
      </aside>
    </div>
  );
}
