// 검수용 가짜 카카오 지도 SDK. 실제 카카오 서버에 접근하지 않고 이 서비스가 쓰는 부분만 흉내 낸다.
// 지도는 단순 등장방형 투영, 주소·장소·로드뷰는 고정 응답이다. 테스트 타일 서버가 /kakao-mock.js 로 내보낸다.
(function () {
  const R = 6371008.8, OLAT = 36, OLON = 129.3, REF = 36.04, SIZE = 200, RAD = Math.PI / 180;
  const cellCenter = (x, y) => ({ lat: OLAT + (y + 0.5) * SIZE / R / RAD, lng: OLON + (x + 0.5) * SIZE / (R * Math.cos(REF * RAD)) / RAD });

  function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
  LatLng.prototype.getLat = function () { return this.lat; };
  LatLng.prototype.getLng = function () { return this.lng; };
  function LatLngBounds() { this.pts = []; }
  LatLngBounds.prototype.extend = function (p) { this.pts.push(p); };
  LatLngBounds.prototype.isEmpty = function () { return this.pts.length === 0; };

  const event = {
    addListener(t, type, fn) { (t.__l ||= {}); (t.__l[type] ||= []).push(fn); },
    trigger(t, type, arg) { for (const fn of (t.__l?.[type] ?? [])) fn(arg); },
  };

  const pxPerDeg = (level) => 256 * Math.pow(2, 20 - level) / 360;
  function Map(node, opts) {
    this.node = node; this.center = opts.center; this.level = opts.level; this.items = [];
    node.classList.add('kmock-map');
    node.style.position = node.style.position || 'relative';
    node.style.overflow = 'hidden';
    this.layer = document.createElement('div');
    this.layer.className = 'kmock-layer';
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    node.appendChild(this.layer);
    node.addEventListener('click', (e) => {
      if (e.target.closest('.kmock-stop')) return;
      const r = node.getBoundingClientRect();
      event.trigger(this, 'click', { latLng: this.unproject(e.clientX - r.left, e.clientY - r.top) });
    });
    setTimeout(() => event.trigger(this, 'tilesloaded'), 30);
  }
  Map.prototype.project = function (ll) {
    const k = pxPerDeg(this.level), w = this.node.clientWidth, h = this.node.clientHeight;
    return { x: w / 2 + (ll.lng - this.center.lng) * k, y: h / 2 - (ll.lat - this.center.lat) * k / Math.cos(REF * RAD) };
  };
  Map.prototype.unproject = function (x, y) {
    const k = pxPerDeg(this.level), w = this.node.clientWidth, h = this.node.clientHeight;
    return new LatLng(this.center.lat - (y - h / 2) * Math.cos(REF * RAD) / k, this.center.lng + (x - w / 2) / k);
  };
  Map.prototype.render = function () { for (const it of this.items) it.draw?.(); this.node.dataset.level = String(this.level); };
  Map.prototype.setCenter = function (c) { this.center = c; this.render(); };
  Map.prototype.panTo = Map.prototype.setCenter;
  Map.prototype.getCenter = function () { return this.center; };
  Map.prototype.panBy = function (dx, dy) { this.center = this.unproject(this.node.clientWidth / 2 + dx, this.node.clientHeight / 2 + dy); this.render(); };
  Map.prototype.setLevel = function (l) { this.level = l; this.render(); };
  Map.prototype.getLevel = function () { return this.level; };
  Map.prototype.relayout = function () { this.render(); };
  Map.prototype.addControl = function () {};
  Map.prototype.setBounds = function (b) {
    if (!b.pts.length) return;
    const lats = b.pts.map((p) => p.lat), lngs = b.pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    this.center = new LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
    let level = 1;
    while (level < 14) {
      const k = pxPerDeg(level);
      if ((maxLng - minLng) * k <= this.node.clientWidth && (maxLat - minLat) * k / Math.cos(REF * RAD) <= this.node.clientHeight) break;
      level += 1;
    }
    this.level = level;
    this.render();
  };

  function overlay(kind) {
    return function (opts) {
      this.opts = opts; this.kind = kind; this.map = null;
      this.el = document.createElement('div');
      this.el.className = `kmock-${kind}`;
      this.el.style.position = 'absolute';
      if (kind === 'overlay') {
        this.el.appendChild(opts.content);
        this.el.style.pointerEvents = 'auto';
        if (opts.clickable) this.el.classList.add('kmock-stop');
      } else {
        const path = opts.path ?? [];
        this.el.dataset.rings = String(Array.isArray(path[0]) ? path.length : 1);
      }
      if (opts.map) this.setMap(opts.map);
    };
  }
  const CustomOverlay = overlay('overlay'), Polygon = overlay('polygon'), Circle = overlay('circle'), Polyline = overlay('polyline');
  for (const C of [CustomOverlay, Polygon, Circle, Polyline]) {
    C.prototype.setMap = function (m) {
      if (this.map) { this.map.items = this.map.items.filter((i) => i !== this); this.el.remove(); }
      this.map = m;
      if (!m) return;
      m.items.push(this);
      m.layer.appendChild(this.el);
      this.draw();
    };
    C.prototype.setPosition = function (p) { this.opts.position = p; this.draw(); };
    C.prototype.getMap = function () { return this.map; };
    C.prototype.draw = function () {
      const pos = this.opts.position ?? this.opts.center;
      if (!pos || !this.map) return;
      const p = this.map.project(pos);
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      this.el.style.left = `${p.x - (this.opts.xAnchor ?? 0.5) * w}px`;
      this.el.style.top = `${p.y - (this.opts.yAnchor ?? 0.5) * h}px`;
      this.el.style.zIndex = String(this.opts.zIndex ?? 1);
    };
  }

  const Status = { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' };
  function Geocoder() {}
  Geocoder.prototype.coord2Address = function (lng, lat, cb) {
    // 위치마다 다른 건물 번호를 돌려 주변 목록이 여러 줄이 되게 한다.
    const n = 100 + Math.floor((lat - 36) * 2000) % 50 + Math.floor((lng - 129) * 1500) % 40;
    setTimeout(() => cb([{
      road_address: { address_name: `경북 포항시 북구 검수로 ${n}`, zone_no: `37${String(500 + n).slice(-3)}`, building_name: '' },
      address: { address_name: `경북 포항시 북구 검수동 ${n}-1` },
    }], Status.OK), 5);
  };
  Geocoder.prototype.addressSearch = function (q, cb) {
    const a = cellCenter(40, 44), b = cellCenter(30, 25);
    setTimeout(() => cb([
      { x: String(a.lng), y: String(a.lat), road_address: { address_name: `경북 포항시 북구 ${q} 1`, zone_no: '37601', building_name: '검수빌딩' }, address: { address_name: '경북 포항시 북구 검수동 1-1' } },
      { x: String(b.lng), y: String(b.lat), road_address: { address_name: `경북 포항시 남구 ${q} 2`, zone_no: '37602', building_name: '' }, address: { address_name: '경북 포항시 남구 검수동 2-1' } },
    ], Status.OK), 5);
  };
  function Places() {}
  Places.prototype.keywordSearch = function (q, cb) {
    const c = cellCenter(35, 30);
    setTimeout(() => cb([
      { id: 'p1', place_name: `${q} 검수장소`, road_address_name: '경북 포항시 북구 검수로 9', address_name: '경북 포항시 북구 검수동 9', x: String(c.lng), y: String(c.lat) },
      { id: 'p2', place_name: `${q} 영역밖장소`, road_address_name: '경북 경주시 검수로 1', address_name: '경북 경주시 검수동 1', x: '129.2', y: '35.8' },
    ], Status.OK), 5);
  };

  function Viewpoint(pan, tilt, zoom, panoId) { this.pan = pan; this.tilt = tilt; this.zoom = zoom; this.panoId = panoId; }
  // 가짜 로드뷰: 가로 시야 90도의 원근 투영. 오버레이는 Viewpoint 방향에 그린다.
  function Roadview(node) { this.node = node; this.vp = { pan: 30, tilt: 0, zoom: 0 }; this.items = []; this.panoId = null; }
  Roadview.prototype.setPanoId = function (id) {
    this.panoId = id;
    this.node.innerHTML = `<div class="kmock-roadview" style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;background:#355">ROADVIEW ${id}</div>`;
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.node.appendChild(this.layer);
  };
  Roadview.prototype.getPanoId = function () { return this.panoId; };
  Roadview.prototype.getViewpoint = function () { return new Viewpoint(this.vp.pan, this.vp.tilt, this.vp.zoom, this.panoId); };
  Roadview.prototype.setViewpoint = function (v) { this.vp = { pan: v.pan, tilt: v.tilt, zoom: v.zoom }; for (const it of this.items) it.draw(); };
  Roadview.prototype.relayout = function () {};
  Roadview.prototype.project = function (pos) {
    const w = this.node.clientWidth, h = this.node.clientHeight, f = (w / 2) / Math.tan(45 * RAD);
    const dp = ((pos.pan - this.vp.pan + 540) % 360) - 180, dt = pos.tilt - this.vp.tilt;
    return { x: w / 2 + f * Math.tan(dp * RAD), y: h / 2 + f * Math.tan(dt * RAD) / Math.cos(dp * RAD) };
  };
  function RoadviewClient() {}
  // 검수 영역 북쪽(36.1 이상)은 로드뷰가 없다고 답한다.
  RoadviewClient.prototype.getNearestPanoId = function (pos, r, cb) { setTimeout(() => cb(pos.getLat() > 36.1 ? null : 4242), 5); };

  window.kakao = {
    maps: {
      load(cb) { setTimeout(cb, 0); },
      LatLng, LatLngBounds, Map, CustomOverlay, Polygon, Circle, Polyline, event,
      ZoomControl: function () {}, ControlPosition: { RIGHT: 'RIGHT' },
      Roadview, RoadviewClient, Viewpoint,
      services: { Geocoder, Places, Status },
    },
  };
})();
