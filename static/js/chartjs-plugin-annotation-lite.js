(function() {
  const simpleAnnotationPlugin = {
    id: 'simple-annotation',
    afterDraw(chart) {
      const anns = chart.options.plugins && chart.options.plugins.annotation && chart.options.plugins.annotation.annotations;
      if (!anns) return;
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      Object.keys(anns).forEach(key => {
        const ann = anns[key];
        if (ann.type !== 'line') return;
        const color = ann.borderColor || 'rgba(0,0,0,0.5)';
        const width = ann.borderWidth || 1;
        const dash = ann.borderDash || [];
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        if (ann.xMin !== undefined) {
          const x = xScale.getPixelForValue(ann.xMin);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
        } else if (ann.yMin !== undefined) {
          const y = yScale.getPixelForValue(ann.yMin);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, y);
          ctx.lineTo(chartArea.right, y);
          ctx.stroke();
        }
        if (ann.label && ann.label.enabled && ann.label.content) {
          const font = ann.label.font || {};
          ctx.fillStyle = ann.label.color || color;
          ctx.font = `${font.weight || ''} ${font.size || 12}px ${font.family || 'Arial'}`;
          ctx.textBaseline = 'bottom';
          const padding = ann.label.padding || {};
          const text = ann.label.content;
          let lx = chartArea.left + (padding.left || 0);
          let ly = chartArea.top + (padding.top || 0);
          if (ann.xMin !== undefined) {
            lx = xScale.getPixelForValue(ann.xMin) + (padding.left || 0);
          }
          if (ann.yMin !== undefined) {
            ly = yScale.getPixelForValue(ann.yMin) - (padding.bottom || 0);
          }
          ctx.fillText(text, lx, ly);
        }
        ctx.restore();
      });
    }
  };
  if (window.Chart) {
    Chart.register(simpleAnnotationPlugin);
  }
  window.simpleAnnotationPlugin = simpleAnnotationPlugin;
})();
