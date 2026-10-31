(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'zerify-injected-styles';

  var DEFAULTS = {
    height: 64,
    padding: 12,
    lineWidth: 3,
    strokeColor: '#2563eb',
    strokeSoft: 'rgba(37, 99, 235, 0.16)',
    successColor: '#16a34a',
    successSoft: 'rgba(22, 163, 74, 0.16)',
    failColor: '#dc2626',
    failSoft: 'rgba(220, 38, 38, 0.16)',
    guideColor: '#cbd5e1',
    minPoints: 8,
    minLengthRatio: 0.5,
    maxSlopeRatio: 0.28,
    maxDeviationRatio: 0.16,
    maxPointDeviationRatio: 0.45,
    minDuration: 120,
    maxDuration: 15000,
    minSpeedVariation: 0.05,
    maxBacktrackRatio: 0.2,
    showCheck: true,
    hint: '按住并水平拖动，画一条横线',
    successText: '验证通过',
    failPrefix: '验证失败：',
    onSuccess: null,
    onFail: null,
    onReset: null
  };

  var STYLES = `
.zerify{display:block;width:100%;font:inherit;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.zerify-canvas-wrap{position:relative;width:100%;overflow:hidden;border-radius:12px;background:#f8fafc;box-shadow:inset 0 0 0 1px #e2e8f0;transition:box-shadow .2s ease,background .2s ease}
.zerify-canvas{display:block;width:100%;touch-action:none;cursor:crosshair}
.zerify-status{margin-top:9px;font-size:13px;line-height:1.45;color:#64748b;min-height:19px;transition:color .15s ease}
.zerify-status.is-success{color:#16a34a;font-weight:600}
.zerify-status.is-fail{color:#dc2626;font-weight:600}
.zerify.is-success .zerify-canvas-wrap{box-shadow:inset 0 0 0 2px rgba(22,163,74,.5);background:#f6fef9}
.zerify.is-fail .zerify-canvas-wrap{box-shadow:inset 0 0 0 2px rgba(220,38,38,.5);background:#fef6f6}
.zerify.is-success .zerify-canvas{cursor:default}
.zerify.is-disabled .zerify-canvas{cursor:not-allowed}
.zerify.is-disabled{opacity:.62}
.zerify-check{position:absolute;top:50%;left:50%;width:54px;height:54px;margin:-27px 0 0 -27px;opacity:0;transform:scale(.55);pointer-events:none;transition:opacity .16s ease,transform .3s cubic-bezier(.22,1.6,.4,1)}
.zerify-check.is-visible{opacity:1;transform:scale(1)}
.zerify-check-ring{fill:rgba(255,255,255,.94);stroke:#16a34a;stroke-width:3;stroke-dasharray:264;stroke-dashoffset:264}
.zerify-check-mark{fill:none;stroke:#16a34a;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:68;stroke-dashoffset:68}
.zerify-check.is-visible .zerify-check-ring{animation:zerify-ring .55s ease forwards}
.zerify-check.is-visible .zerify-check-mark{animation:zerify-mark .36s .18s ease forwards}
.zerify-canvas-wrap.is-shake{animation:zerify-shake .4s ease}
@keyframes zerify-ring{to{stroke-dashoffset:0}}
@keyframes zerify-mark{to{stroke-dashoffset:0}}
@keyframes zerify-shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-7px)}35%{transform:translateX(6px)}55%{transform:translateX(-4px)}75%{transform:translateX(3px)}}
`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function createCheckSvg() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'zerify-check');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'zerify-check-ring');
    ring.setAttribute('cx', '50');
    ring.setAttribute('cy', '50');
    ring.setAttribute('r', '42');

    var mark = document.createElementNS(SVG_NS, 'path');
    mark.setAttribute('class', 'zerify-check-mark');
    mark.setAttribute('d', 'M30 52 L45 67 L72 36');

    svg.appendChild(ring);
    svg.appendChild(mark);
    return svg;
  }

  function Zerify(target, options) {
    if (!(this instanceof Zerify)) return new Zerify(target, options);
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('Zerify: 未找到目标容器');

    injectStyles();

    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.root = el;
    this.points = [];
    this.isDrawing = false;
    this.verified = false;
    this.failed = false;
    this.disabled = false;
    this._token = 0;
    this._shakeTimer = 0;
    this._resizeRaf = 0;
    this._ro = null;

    this.root.classList.add('zerify');
    this._build();
    this._bind();
    this._resize();

    var self = this;
    requestAnimationFrame(function () {
      self._resize();
    });
  }

  Zerify.prototype._build = function () {
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'zerify-canvas-wrap';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'zerify-canvas';
    this.canvas.style.height = this.opts.height + 'px';

    this.check = createCheckSvg();

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'zerify-status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.statusEl.textContent = this.opts.hint;

    this.canvasWrap.appendChild(this.canvas);
    this.canvasWrap.appendChild(this.check);
    this.root.appendChild(this.canvasWrap);
    this.root.appendChild(this.statusEl);

    this.ctx = this.canvas.getContext('2d');
  };

  Zerify.prototype._bind = function () {
    var self = this;

    this._onDown = function (e) {
      if (self.verified || self.disabled) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      e.preventDefault();

      self._token++;
      clearTimeout(self._shakeTimer);
      self.canvasWrap.classList.remove('is-shake');
      self.root.classList.remove('is-fail', 'is-success');
      self._hideCheck();

      self.failed = false;
      self.isDrawing = true;
      self.points = [self._pos(e)];

      self.statusEl.className = 'zerify-status';
      self.statusEl.textContent = '正在记录轨迹…';

      try {
        self.canvas.setPointerCapture(e.pointerId);
      } catch (err) {}

      self._render();
    };

    this._onMove = function (e) {
      if (!self.isDrawing || self.verified) return;
      e.preventDefault();

      var p = self._pos(e);
      var last = self.points[self.points.length - 1];
      if (last) {
        var ddx = p.x - last.x;
        var ddy = p.y - last.y;
        if (ddx * ddx + ddy * ddy < 4) return;
      }

      self.points.push(p);
      if (self.points.length > 2500) self.points.shift();
      self._render();
    };

    this._onUp = function (e) {
      if (!self.isDrawing) return;
      self.isDrawing = false;
      try {
        self.canvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (self.points.length) self._evaluate();
    };

    this._onCancel = function () {
      if (!self.isDrawing) return;
      self.isDrawing = false;
      self.points = [];
      self.failed = false;
      self._render();
      self.statusEl.className = 'zerify-status';
      self.statusEl.textContent = self.opts.hint;
    };

    this._onResize = function () {
      if (self._resizeRaf) cancelAnimationFrame(self._resizeRaf);
      self._resizeRaf = requestAnimationFrame(function () {
        self._resizeRaf = 0;
        self._resize();
      });
    };

    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onCancel);
    this.canvas.addEventListener('lostpointercapture', this._onUp);

    window.addEventListener('resize', this._onResize);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.canvasWrap);
    }
  };

  Zerify.prototype._pos = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var scaleX = rect.width ? this.cssWidth / rect.width : 1;
    var scaleY = rect.height ? this.cssHeight / rect.height : 1;
    var t = typeof e.timeStamp === 'number' ? e.timeStamp : performance.now();
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      t: t
    };
  };

  Zerify.prototype._resize = function () {
    if (!this.canvasWrap) return;
    var rect = this.canvasWrap.getBoundingClientRect();
    var w = Math.max(120, Math.round(rect.width || 0));
    var h = this.opts.height;
    var dpr = Math.min(3, window.devicePixelRatio || 1);

    this.cssWidth = w;
    this.cssHeight = h;

    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._render();
  };

  Zerify.prototype._render = function () {
    var ctx = this.ctx;
    if (!ctx) return;

    var o = this.opts;
    var w = this.cssWidth;
    var h = this.cssHeight;
    var pad = o.padding;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = o.guideColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pad, h / 2);
    ctx.lineTo(w - pad, h / 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = o.guideColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pad, h / 2 - 7);
    ctx.lineTo(pad, h / 2 + 7);
    ctx.moveTo(w - pad, h / 2 - 7);
    ctx.lineTo(w - pad, h / 2 + 7);
    ctx.stroke();
    ctx.restore();

    if (!this.points.length) return;

    var color = this.verified ? o.successColor : (this.failed ? o.failColor : o.strokeColor);
    var soft = this.verified ? o.successSoft : (this.failed ? o.failSoft : o.strokeSoft);

    if (this.points.length === 1) {
      var p0 = this.points[0];
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, o.lineWidth + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.strokeStyle = soft;
    ctx.lineWidth = o.lineWidth + 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this._trace(ctx);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = o.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this._trace(ctx);
    ctx.stroke();
    ctx.restore();

    this._endpoint(ctx, this.points[0], color);
    this._endpoint(ctx, this.points[this.points.length - 1], color);
  };

  Zerify.prototype._trace = function (ctx) {
    var pts = this.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }

    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2;
      var my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }

    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  };

  Zerify.prototype._endpoint = function (ctx, p, color) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  Zerify.prototype._evaluate = function () {
    var o = this.opts;
    var pts = this.points;
    var w = this.cssWidth;
    var h = this.cssHeight;
    var pad = o.padding;
    var usable = Math.max(1, w - pad * 2);

    if (pts.length < o.minPoints) {
      return this._fail('轨迹点太少，请慢一点画');
    }

    var start = pts[0];
    var end = pts[pts.length - 1];
    var duration = end.t - start.t;

    if (duration < o.minDuration) return this._fail('画得太快了，请重试');
    if (duration > o.maxDuration) return this._fail('停留时间过长，请重新画');

    var dx = end.x - start.x;
    var dy = end.y - start.y;

    if (Math.abs(dx) < usable * o.minLengthRatio) return this._fail('线条长度不足');
    if (Math.abs(dy) > h * o.maxSlopeRatio) return this._fail('线条不够目标水平');

    var dir = dx >= 0 ? 1 : -1;
    var backtracks = 0;
    for (var i = 1; i < pts.length; i++) {
      if ((pts[i].x - pts[i - 1].x) * dir < -0.5) backtracks++;
    }
    if (backtracks / pts.length > o.maxBacktrackRatio) {
      return this._fail('检测到明显的来回移动');
    }

    var totalDev = 0;
    var maxDev = 0;
    var inner = 0;
    for (var j = 1; j < pts.length - 1; j++) {
      var t = (pts[j].x - start.x) / (dx || 1);
      var refY = start.y + t * dy;
      var dev = Math.abs(pts[j].y - refY);
      totalDev += dev;
      if (dev > maxDev) maxDev = dev;
      inner++;
    }

    var avgDev = inner ? totalDev / inner : 0;
    if (avgDev > h * o.maxDeviationRatio) return this._fail('线条偏离过大');
    if (maxDev > h * o.maxPointDeviationRatio) return this._fail('线条抖动过大');

    var speeds = [];
    var zeroGaps = 0;
    for (var k = 1; k < pts.length; k++) {
      var sx = pts[k].x - pts[k - 1].x;
      var sy = pts[k].y - pts[k - 1].y;
      var dt = pts[k].t - pts[k - 1].t;
      if (dt < 1) {
        zeroGaps++;
        dt = 1;
      }
      speeds.push(Math.sqrt(sx * sx + sy * sy) / dt);
    }

    var sum = 0;
    for (var s = 0; s < speeds.length; s++) sum += speeds[s];
    var mean = speeds.length ? sum / speeds.length : 0;
    if (mean <= 0.0001) return this._fail('轨迹异常');

    var varSum = 0;
    for (var v = 0; v < speeds.length; v++) {
      var diff = speeds[v] - mean;
      varSum += diff * diff;
    }
    var cv = Math.sqrt(varSum / speeds.length) / mean;

    if (zeroGaps / pts.length > 0.6) return this._fail('轨迹过于机械');
    if (cv < o.minSpeedVariation) return this._fail('轨迹过于机械');

    this._success();
  };

  Zerify.prototype._success = function () {
    this._token++;
    this.verified = true;
    this.failed = false;

    this._render();
    this._showCheck();

    this.root.classList.remove('is-fail');
    this.root.classList.add('is-success');
    this.statusEl.className = 'zerify-status is-success';
    this.statusEl.textContent = this.opts.successText;

    if (typeof this.opts.onSuccess === 'function') this.opts.onSuccess(this);
  };

  Zerify.prototype._fail = function (reason) {
    var self = this;
    var token = ++this._token;

    this.verified = false;
    this.failed = true;
    this._hideCheck();
    this._render();

    this.root.classList.remove('is-success');
    this.root.classList.add('is-fail');
    this.statusEl.className = 'zerify-status is-fail';
    this.statusEl.textContent = this.opts.failPrefix + reason;

    this.canvasWrap.classList.remove('is-shake');
    void this.canvasWrap.offsetWidth;
    this.canvasWrap.classList.add('is-shake');

    clearTimeout(this._shakeTimer);
    this._shakeTimer = setTimeout(function () {
      if (token !== self._token) return;
      self.canvasWrap.classList.remove('is-shake');
      self.root.classList.remove('is-fail');
      self.failed = false;
      self.points = [];
      self._render();
      self.statusEl.className = 'zerify-status';
      self.statusEl.textContent = self.opts.hint;
    }, 950);

    if (typeof this.opts.onFail === 'function') this.opts.onFail(reason, this);
  };

  Zerify.prototype._showCheck = function () {
    if (!this.opts.showCheck || !this.check) return;
    this.check.classList.remove('is-visible');
    void this.check.offsetWidth;
    this.check.classList.add('is-visible');
  };

  Zerify.prototype._hideCheck = function () {
    if (this.check) this.check.classList.remove('is-visible');
  };

  Zerify.prototype.reset = function () {
    this._token++;
    clearTimeout(this._shakeTimer);

    this.points = [];
    this.isDrawing = false;
    this.verified = false;
    this.failed = false;

    this.canvasWrap.classList.remove('is-shake');
    this.root.classList.remove('is-success', 'is-fail');
    this._hideCheck();
    this._render();

    this.statusEl.className = 'zerify-status';
    this.statusEl.textContent = this.opts.hint;

    if (typeof this.opts.onReset === 'function') this.opts.onReset(this);
  };

  Zerify.prototype.setDisabled = function (flag) {
    this.disabled = !!flag;
    this.root.classList.toggle('is-disabled', this.disabled);
  };

  Zerify.prototype.isVerified = function () {
    return this.verified === true;
  };

  Zerify.prototype.destroy = function () {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    clearTimeout(this._shakeTimer);

    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onCancel);
    this.canvas.removeEventListener('lostpointercapture', this._onUp);

    this.root.innerHTML = '';
    this.root.classList.remove('zerify', 'is-success', 'is-fail', 'is-disabled');
  };

  global.Zerify = Zerify;
})(window);