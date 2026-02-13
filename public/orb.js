// ===== 动态光球引擎 =====
class OrbAnimator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.resize();

    // 状态
    this.state = 'idle';
    this.customColors = null; // 角色自定义颜色
    this.targetColor = { r: 102, g: 126, b: 234 }; // idle blue
    this.currentColor = { ...this.targetColor };
    this.targetRadius = 0;
    this.currentRadius = 0;
    this.baseRadius = 0;
    this.time = 0;

    // 粒子系统
    this.particles = [];
    for (let i = 0; i < 40; i++) {
      this.particles.push(this._createParticle());
    }

    // 波纹
    this.ripples = [];

    // 音频数据（用于波形）
    this.audioLevel = 0;
    this.targetAudioLevel = 0;

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.baseRadius = Math.min(this.width, this.height) * 0.22;
    this.targetRadius = this.baseRadius;
    this.currentRadius = this.baseRadius;
  }

  // 更新角色颜色主题
  updateColors(colorMap) {
    if (colorMap) {
      this.customColors = { ...this.customColors, ...colorMap };
      // 立即更新当前状态的颜色
      const colors = this._getColors();
      this.targetColor = colors[this.state] || colors.idle;
    }
  }

  _getColors() {
    return {
      idle:      this.customColors?.idle      || { r: 102, g: 126, b: 234 },
      listening: this.customColors?.listening  || { r: 239, g: 68,  b: 68  },
      thinking:  this.customColors?.thinking   || { r: 245, g: 158, b: 11  },
      speaking:  this.customColors?.speaking   || { r: 118, g: 75,  b: 162 },
      happy:     this.customColors?.happy      || { r: 74,  g: 222, b: 128 },
      error:     this.customColors?.error      || { r: 239, g: 68,  b: 68  }
    };
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;

    const colors = this._getColors();
    this.targetColor = colors[state] || colors.idle;

    // 状态切换时添加波纹
    this.ripples.push({
      radius: this.currentRadius,
      maxRadius: this.baseRadius * 3,
      alpha: 0.4,
      speed: state === 'happy' ? 3 : 1.5
    });
  }

  setAudioLevel(level) {
    this.targetAudioLevel = Math.min(1, Math.max(0, level));
  }

  _createParticle() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 0.5 + Math.random() * 1.5;
    return {
      angle,
      dist,
      speed: 0.002 + Math.random() * 0.008,
      size: 1 + Math.random() * 2.5,
      alpha: 0.2 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2
    };
  }

  _lerpColor(current, target, t) {
    return {
      r: current.r + (target.r - current.r) * t,
      g: current.g + (target.g - current.g) * t,
      b: current.b + (target.b - current.b) * t
    };
  }

  _animate() {
    this.time += 0.016;
    const ctx = this.ctx;

    // 清空
    ctx.clearRect(0, 0, this.width, this.height);

    // 平滑颜色过渡
    this.currentColor = this._lerpColor(this.currentColor, this.targetColor, 0.04);
    const { r, g, b } = this.currentColor;

    // 平滑音频级别
    this.audioLevel += (this.targetAudioLevel - this.audioLevel) * 0.15;

    // 计算呼吸效果 + 音频响应
    let breathe = 0;
    let radiusMult = 1;
    switch (this.state) {
      case 'idle':
        breathe = Math.sin(this.time * 1.2) * 0.08;
        break;
      case 'listening':
        breathe = Math.sin(this.time * 2.5) * 0.12;
        radiusMult = 1 + this.audioLevel * 0.3;
        break;
      case 'thinking':
        breathe = Math.sin(this.time * 3) * 0.06;
        radiusMult = 0.9 + Math.sin(this.time * 1.5) * 0.1;
        break;
      case 'speaking':
        breathe = Math.sin(this.time * 2) * 0.1;
        radiusMult = 1 + this.audioLevel * 0.25;
        break;
      case 'happy':
        breathe = Math.sin(this.time * 2) * 0.15;
        radiusMult = 1.1;
        break;
      case 'error':
        breathe = Math.sin(this.time * 8) * 0.05;
        radiusMult = 0.95;
        break;
    }

    this.targetRadius = this.baseRadius * radiusMult;
    this.currentRadius += (this.targetRadius - this.currentRadius) * 0.08;
    const radius = this.currentRadius * (1 + breathe);

    // ===== 绘制外层光晕 =====
    const glowGrad = ctx.createRadialGradient(this.cx, this.cy, radius * 0.5, this.cx, this.cy, radius * 2.5);
    glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.15)`);
    glowGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.05)`);
    glowGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // ===== 绘制波纹 =====
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      rip.radius += rip.speed;
      rip.alpha -= 0.005;

      if (rip.alpha <= 0 || rip.radius >= rip.maxRadius) {
        this.ripples.splice(i, 1);
        continue;
      }

      ctx.beginPath();
      ctx.arc(this.cx, this.cy, rip.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${rip.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // ===== 聆听模式声波环 =====
    if (this.state === 'listening' || this.state === 'speaking') {
      const rings = 3;
      for (let i = 0; i < rings; i++) {
        const ringRadius = radius * (1.3 + i * 0.25) + this.audioLevel * 15 * Math.sin(this.time * 3 + i);
        const ringAlpha = 0.15 - i * 0.04;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${ringAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // ===== 绘制粒子 =====
    for (const p of this.particles) {
      p.angle += p.speed;
      p.pulse += 0.03;

      const pDist = radius * p.dist;
      const wobble = this.state === 'thinking'
        ? Math.sin(this.time * 2 + p.angle * 3) * 8
        : 0;
      const px = this.cx + Math.cos(p.angle) * (pDist + wobble);
      const py = this.cy + Math.sin(p.angle) * (pDist + wobble);
      const pAlpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
      const pSize = p.size * (this.state === 'happy' ? 1.5 : 1);

      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pAlpha})`;
      ctx.fill();
    }

    // ===== 绘制核心光球 =====
    // 内层亮核
    const coreGrad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, radius);
    coreGrad.addColorStop(0, `rgba(255, 255, 255, 0.9)`);
    coreGrad.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.8)`);
    coreGrad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, 0.3)`);
    coreGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // 内发光
    const innerGrad = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, radius * 0.5);
    innerGrad.addColorStop(0, `rgba(255, 255, 255, 0.6)`);
    innerGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);

    ctx.beginPath();
    ctx.arc(this.cx, this.cy, radius * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = innerGrad;
    ctx.fill();

    // ===== Thinking 旋转指示器 =====
    if (this.state === 'thinking') {
      const arcLen = Math.PI * 0.6;
      const arcStart = this.time * 3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius * 1.2, arcStart, arcStart + arcLen);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 持续聆听模式自动产生波纹
    if (this.state === 'listening' && Math.random() < 0.03) {
      this.ripples.push({
        radius: radius,
        maxRadius: radius * 2.5,
        alpha: 0.2,
        speed: 0.8
      });
    }

    requestAnimationFrame(this._animate);
  }
}

// 导出
window.OrbAnimator = OrbAnimator;
