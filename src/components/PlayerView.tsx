'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import MapView from './map/MapView';
import { useI18n } from './I18nProvider';
import { usePublicSnapshot } from '@/lib/client/usePublicSnapshot';
import { useReducedMotion } from '@/lib/client/useReducedMotion';
import { CATEGORY_KEYS } from '@/lib/client/categories';
import { PLAYER_INTERVAL_MS } from '@/lib/domain/freshness';
import { initialPlayer, playerReducer } from '@/lib/domain/player';
import { mapProvider } from '@/lib/map/provider';

function typingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export default function PlayerView() {
  const { t, lang, setLang } = useI18n();
  const { view, retry } = usePublicSnapshot('player');
  const reducedMotion = useReducedMotion();
  const provider = useMemo(() => mapProvider(), []);
  const [state, dispatch] = useReducer(playerReducer, initialPlayer);
  const [tileStatus, setTileStatus] = useState<'ok' | 'failed' | 'unknown'>('unknown');
  const [fullscreen, setFullscreen] = useState(false);
  const [fsError, setFsError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const fresh = view.kind === 'fresh' ? view.cases : null;
  const ids = useMemo(() => (fresh ? fresh.map((c) => c.public_id) : []), [fresh]);
  const idsKey = ids.join('|');
  const idsRef = useRef(ids);
  useEffect(() => { idsRef.current = ids; }, [ids]);

  // 새 공개 목록 반영. 갱신 성공은 재생 시작 동작이 아니다.
  useEffect(() => {
    if (fresh) dispatch({ type: 'data', ids: idsRef.current });
    else dispatch({ type: 'suspend' });
  }, [idsKey, fresh]);

  // 12초 타이머는 재생 중일 때 하나만 유지한다.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => dispatch({ type: 'tick', ids: idsRef.current }), PLAYER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.playing, state.currentId]);

  const current = fresh && state.currentId ? fresh.find((c) => c.public_id === state.currentId) ?? null : null;
  const index = current && fresh ? fresh.indexOf(current) : -1;
  const total = fresh?.length ?? 0;

  const toggleFullscreen = useCallback(async () => {
    setFsError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen();
      else setFsError(true);
    } catch {
      setFsError(true);
    }
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typingTarget(e.target)) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      // 버튼·링크에서는 Space를 기본 동작에 맡기고, 지도에 초점이 있으면 방향키는 지도 이동에 쓴다.
      const onControl = !!el && ['BUTTON', 'A'].includes(el.tagName);
      const onMap = !!el?.closest('.leaflet-container');
      if (onMap && e.key.startsWith('Arrow')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); dispatch({ type: 'prev', ids: idsRef.current }); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); dispatch({ type: 'next', ids: idsRef.current }); }
      else if ((e.key === ' ' || e.code === 'Space') && !onControl) { e.preventDefault(); dispatch({ type: 'toggle', ids: idsRef.current }); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); void toggleFullscreen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  const focus = useMemo(() => (current ? { lat: current.location.lat, lon: current.location.lon, zoom: 15, token: index } : null), [current, index]);
  const groups = useMemo(() => (current ? [{
    key: current.public_id, lat: current.location.lat, lon: current.location.lon, count: index + 1,
    category: current.category, active: true, label: t(CATEGORY_KEYS[current.category]),
  }] : []), [current, index, t]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const canMove = total > 1;

  return (
    <div className={`player${fullscreen ? ' player--fullscreen' : ''}`} ref={stage}>
      <header className="player__bar">
        <span className="player__brand">{t('site.title')}</span>
        <span className="player__crumb"><span className="player__eyebrow">COMMUNITY VOICES</span> {t('player.title')}</span>
        <span className="player__links">
          <button type="button" className="player__lang" onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')} aria-label={t('nav.langLabel')}>{t('nav.lang')}</button>
          <Link href="/map">{t('player.back')} <span aria-hidden="true">↗</span></Link>
        </span>
      </header>

      <div className="player__stage">
        <section className="player__map" aria-label={t('player.place')}>
          <MapView provider={provider} ariaLabel={t('player.place')} groups={groups} focus={focus} reducedMotion={reducedMotion} onTileStatus={setTileStatus} compact />
          {(!provider || tileStatus === 'failed') && current ? (
            <div className="map-alert map-alert--dark" role="status">
              <span>{t('player.mapUnavailable')}</span>
              <strong>{t('player.coords', { lat: current.location.lat.toFixed(5), lon: current.location.lon.toFixed(5) })}</strong>
            </div>
          ) : null}
        </section>

        <section className="player__card" aria-live="polite" aria-atomic="true">
          {current ? (
            <article key={current.public_id} className={reducedMotion ? 'case' : 'case case--enter'}>
              <div className="case__top">
                <span className={`cat-label cat-label--${current.category}`}>{t(CATEGORY_KEYS[current.category])}</span>
                <span className="case__index">{pad(index + 1)} / {pad(total)}</span>
              </div>
              <p className="case__eyebrow">{t('player.label')} · {t('list.summaryLabel')}</p>
              <p className="case__summary">{current.summary}</p>
              <div className="case__place">
                <span aria-hidden="true">⌖</span>
                <span>
                  <span className="muted">{t('player.place')}</span>
                  <strong>{t('list.approx')} · {t('list.approxHelp')}</strong>
                </span>
              </div>
              <p className="case__note">{t('player.reviewed')}</p>
            </article>
          ) : (
            <PlayerState kind={view.kind} total={total} onRetry={retry} />
          )}
        </section>
      </div>

      <div className="player__controls">
        <button type="button" className="ctrl" onClick={() => dispatch({ type: 'prev', ids })} disabled={!canMove} aria-label={t('player.prev')}>‹</button>
        <button type="button" className="ctrl ctrl--main" onClick={() => dispatch({ type: 'toggle', ids })} disabled={!canMove} aria-label={state.playing ? t('player.pause') : t('player.play')} aria-pressed={state.playing}>
          {state.playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="ctrl" onClick={() => dispatch({ type: 'next', ids })} disabled={!canMove} aria-label={t('player.next')}>›</button>
        <span className="player__status">{total === 1 ? t('player.status.single') : state.playing ? t('player.status.playing') : t('player.status.paused')}</span>
        <span className="progress" aria-hidden="true">
          <span key={`${state.currentId}-${state.playing}`} className={state.playing && !reducedMotion ? 'progress__bar progress__bar--run' : 'progress__bar'} style={{ width: state.playing ? undefined : total ? `${((index + 1) / total) * 100}%` : '0%' }} />
        </span>
        <span className="player__count">{total ? `${pad(index + 1)} / ${pad(total)}` : '00 / 00'}</span>
        <button type="button" className="ctrl" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}>⛶</button>
      </div>
      <p className="player__keys">{fsError ? <span role="alert">{t('player.fullscreenFailed')} </span> : null}{t('player.keys')}</p>
    </div>
  );
}

function PlayerState({ kind, total, onRetry }: { kind: string; total: number; onRetry: () => void }) {
  const { t } = useI18n();
  if (kind === 'fresh' && total === 0) {
    return (
      <div className="case case--empty">
        <p className="case__summary case__summary--small">{t('player.empty')}</p>
        <p>{t('player.emptyBody')}</p>
        <Link href="/submit" className="btn btn--light">{t('cta.write')}</Link>
      </div>
    );
  }
  const message = kind === 'loading' ? t('state.loading') : kind === 'error' ? t('state.error') : kind === 'offline' ? t('state.offline') : kind === 'paused' ? t('state.paused') : t('state.unverified');
  return (
    <div className="case case--empty" role="status">
      <p>{message}</p>
      {kind === 'error' || kind === 'unverified' ? <button type="button" className="btn btn--light" onClick={onRetry}>{t('state.retry')}</button> : null}
    </div>
  );
}
