/* ============================================================
   GLORY KIDS — SERIES CAROUSEL
   Horizontal scroll-snap carousel: arrow buttons, click-drag,
   and synced progress dots. Runs immediately (script sits at the
   bottom of the page, after the markup it controls).
   ============================================================ */
(function () {
  var root = document.getElementById('seriesCarousel');
  if (!root) return;

  var viewport = root.querySelector('.gk-carousel__viewport');
  var track = root.querySelector('.gk-carousel__track');
  var prevBtn = root.querySelector('.gk-carousel__arrow--prev');
  var nextBtn = root.querySelector('.gk-carousel__arrow--next');
  var dotsWrap = document.getElementById('seriesCarouselDots');
  var cards = Array.prototype.slice.call(track.children);

  /* Build progress dots */
  cards.forEach(function (card, i) {
    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'gk-carousel__dot';
    dot.setAttribute('aria-label', 'Go to series ' + (i + 1));
    dot.addEventListener('click', function () {
      scrollToCard(i);
    });
    dotsWrap.appendChild(dot);
  });
  var dots = Array.prototype.slice.call(dotsWrap.children);

  function scrollToCard(i) {
    var card = cards[i];
    var targetLeft = card.offsetLeft - track.offsetLeft;
    viewport.scrollTo({ left: targetLeft, behavior: 'instant' });
    updateArrowsAndDots();
  }

  function step() {
    var card = cards[0];
    var gap = parseFloat(getComputedStyle(track).gap) || 28;
    return card.getBoundingClientRect().width + gap;
  }

  /* Scroll jumps are instant + immediately followed by a state update,
     rather than relying on the browser's smooth-scroll animation to
     fire 'scroll' events (unreliable across engines/contexts). The
     CSS transition on card hover/press still keeps things feeling
     lively; scroll-snap keeps native touch/trackpad scrolling smooth. */
  prevBtn.addEventListener('click', function () {
    viewport.scrollBy({ left: -step(), behavior: 'instant' });
    updateArrowsAndDots();
  });
  nextBtn.addEventListener('click', function () {
    viewport.scrollBy({ left: step(), behavior: 'instant' });
    updateArrowsAndDots();
  });

  function updateArrowsAndDots() {
    var max = viewport.scrollWidth - viewport.clientWidth - 2;
    prevBtn.disabled = viewport.scrollLeft <= 2;
    nextBtn.disabled = viewport.scrollLeft >= max;

    var closestIndex = 0;
    var closestDist = Infinity;
    cards.forEach(function (card, i) {
      var dist = Math.abs((card.offsetLeft - track.offsetLeft) - viewport.scrollLeft);
      if (dist < closestDist) { closestDist = dist; closestIndex = i; }
    });
    dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === closestIndex); });
  }

  var rafId = null;
  viewport.addEventListener('scroll', function () {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      updateArrowsAndDots();
      rafId = null;
    });
  });

  /* Click-and-drag scrolling (mouse) — touch scrolls natively */
  var isDown = false;
  var startX = 0;
  var startScroll = 0;
  var moved = false;

  viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;
    isDown = true;
    moved = false;
    startX = e.clientX;
    startScroll = viewport.scrollLeft;
    viewport.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', function (e) {
    if (!isDown) return;
    var dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    viewport.scrollLeft = startScroll - dx;
    updateArrowsAndDots();
  });
  function endDrag() {
    if (!isDown) return;
    isDown = false;
    viewport.classList.remove('is-dragging');
    updateArrowsAndDots();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  /* Prevent the CTA links from firing after a drag */
  track.addEventListener('click', function (e) {
    if (moved) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  updateArrowsAndDots();
  window.addEventListener('resize', updateArrowsAndDots);
})();
