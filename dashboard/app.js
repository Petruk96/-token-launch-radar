// Token Radar's dashboard. It reads window.RADAR, written beside dashboard/ by main.ts, and renders
// the ranked pre-token board, filters, a live-token view and a per-protocol detail drawer. Every byte
// it shows comes from the frozen snapshot; the page makes no network request.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA) {
    app.textContent = 'Token Radar data is missing. Run main.ts to write data.js beside the dashboard.';
    return;
  }

  var SORTS = ['implied', 'tvl', 'growth', 'age', 'name', 'category'];
  var STATUSES = ['all', 'watchlist', 'early'];
  var state = { q: '', category: 'all', status: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };
  var ui = {};
  var dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.id = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');
  document.body.appendChild(dialog);
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });

  var currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return currency.format(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return currency.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'unreported';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function growthClass(n) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    return n >= 0 ? 'pos' : 'neg';
  }
  function categoryKey(row) {
    return row.category || 'Other';
  }
  function sortLabel(key) {
    var labels = { implied: 'implied value', tvl: 'TVL', growth: '7-day growth', age: 'age', name: 'name', category: 'category' };
    return labels[key] || key;
  }

  // The model in one function: the page recomputes a row from the snapshot figures and compares the
  // result with the number board.json carries. The detail view reports any mismatch rather than hiding it.
  function recompute(row) {
    var m = DATA.model;
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (item) {
          if (item !== null && item !== undefined) node.appendChild(typeof item === 'string' ? document.createTextNode(item) : item);
        });
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    try {
      var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      if (params.get('q')) state.q = params.get('q');
      if (params.get('category')) state.category = params.get('category');
      var status = params.get('status');
      if (status && STATUSES.indexOf(status) >= 0) state.status = status;
      state.tab = params.get('tab') === 'live' ? 'live' : 'pre';
      var sort = params.get('sort');
      if (sort && SORTS.indexOf(sort) >= 0) state.sort = sort;
      state.dir = params.get('dir') === '1' ? 1 : -1;
      if (params.get('p')) {
        state.selected = params.get('p');
        state.tab = 'pre';
      }
    } catch (err) {
      state.q = '';
    }
  }
  function writeHash() {
    try {
      var params = new URLSearchParams();
      if (state.tab === 'live') params.set('tab', 'live');
      if (state.q) params.set('q', state.q);
      if (state.category !== 'all') params.set('category', state.category);
      if (state.tab === 'pre' && state.status !== 'all') params.set('status', state.status);
      if (state.tab === 'pre' && (state.sort !== 'implied' || state.dir !== -1)) {
        params.set('sort', state.sort);
        params.set('dir', String(state.dir));
      }
      if (state.selected) params.set('p', state.selected);
      var next = params.toString();
      if (next) window.history.replaceState(null, '', '#' + next);
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      // A local file may refuse history updates; the filters still work in memory.
    }
  }

  function categoriesFor(rows) {
    var set = Object.create(null);
    rows.forEach(function (row) { set[categoryKey(row)] = true; });
    return Object.keys(set).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }
  var preCategories = categoriesFor(DATA.rows);
  var liveCategories = categoriesFor(DATA.live);

  function matchesQuery(row, query) {
    if (!query) return true;
    var hay = [row.name, row.slug, row.category || '', (row.chains || []).join(' '), row.momentum || '', row.symbol || '', row.age_band || ''].join(' ').toLowerCase();
    return hay.indexOf(query) >= 0;
  }

  function filteredPre() {
    var query = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== 'all' && categoryKey(row) !== state.category) return false;
      if (state.status === 'watchlist' && !row.watchlist) return false;
      if (state.status === 'early' && !row.early) return false;
      return matchesQuery(row, query);
    });
  }
  function filteredLive() {
    var query = state.q.trim().toLowerCase();
    return DATA.live.filter(function (row) {
      if (state.category !== 'all' && categoryKey(row) !== state.category) return false;
      return matchesQuery(row, query);
    }).sort(function (a, b) {
      return (b.mcap_usd || 0) - (a.mcap_usd || 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  function sortedPre(list) {
    return list.slice().sort(function (a, b) {
      var av;
      var bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? null : a.change_7d; bv = b.change_7d === null ? null : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? null : a.age_days; bv = b.age_days === null ? null : b.age_days; }
      else if (state.sort === 'category') { av = categoryKey(a).toLowerCase(); bv = categoryKey(b).toLowerCase(); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else {
      state.sort = key;
      state.dir = key === 'name' || key === 'category' ? 1 : -1;
    }
    writeHash();
    renderView();
  }

  function header() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'brand' },
        el('span', { class: 'radar-mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('span', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('span', { class: 'brand-sub', text: 'Launch intelligence' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill' }, el('span', { class: 'dot' }), 'Offline snapshot'),
        el('span', { text: 'DefiLlama · ' + DATA.as_of }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('p', { class: 'eyebrow', text: 'Pre-token protocol intelligence' }),
        el('h1', null, 'Find the launch ', el('em', { text: 'before the token exists.' })),
        el('p', { class: 'lede', text: 'A frozen DefiLlama snapshot, one transparent value model, and a farm plan for every protocol that records no token. The board covers all ' + DATA.watchlist_size + ' watchlist protocols and adds ' + DATA.early_size + ' early candidates below the floor. Rank is the model\u2019s claim, not a price.' }),
        el('div', { class: 'hero-actions' },
          el('a', { class: 'button primary', href: '#board-table' }, 'Open the board'),
          el('a', { class: 'button subtle', href: '#method' }, 'How the model works')
        ),
        el('p', { class: 'asof', text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.model_version + ' model · floor ' + fmtUsd(DATA.floor_usd) + ' · no network calls' })
      ),
      el('div', { class: 'hero-stats' },
        stat('Watchlist covered', DATA.watchlist_size + '/' + DATA.watchlist_size, 'Every slug in the house floor', false),
        stat('Pre-token ranked', String(DATA.board_size), 'Watchlist plus early below-floor rows', false),
        stat('Early below floor', String(DATA.early_size), 'Same model, not a watchlist', true),
        stat('Live tokens', String(DATA.live_total), 'Already recorded; set aside from the board', false)
      )
    );
  }

  function stat(label, value, note, gold) {
    return el('div', { class: 'stat' + (gold ? ' gold' : '') },
      el('span', { text: label }),
      el('strong', { text: value }),
      el('small', { text: note })
    );
  }

  function methodStrip() {
    var m = DATA.model;
    return el('section', { class: 'method-strip' },
      el('div', null,
        el('span', { class: 'label', text: 'The one model' }),
        el('code', { text: 'implied = round( TVL × ' + m.base_multiple + ' × growth × maturity )' })
      ),
      el('p', null, 'Growth is the reported 7-day change clamped to ' + m.growth_floor + '%…' + m.growth_cap + '% and weighted ' + m.growth_weight + '. Age is days since listing, capped at ' + m.maturity_days + '. No protocol name is special-cased. Board median ' + fmtUsd(DATA.median_implied_usd) + '.')
    );
  }

  function controlsPanel() {
    var preTab = el('button', { class: 'tab', type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board' });
    var liveTab = el('button', { class: 'tab', type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (' + DATA.live_total + ')' });
    preTab.addEventListener('click', function () { state.tab = 'pre'; writeHash(); renderView(); });
    liveTab.addEventListener('click', function () { state.tab = 'live'; writeHash(); renderView(); });
    ui.preTab = preTab;
    ui.liveTab = liveTab;

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, category, chain or momentum', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderView(); });
    ui.search = search;

    var category = el('select', { id: 'category', 'aria-label': 'Filter by category' });
    category.addEventListener('change', function () { state.category = category.value; writeHash(); renderView(); });
    ui.category = category;

    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name'], ['category', 'Category']].map(function (pair) {
        return el('option', { value: pair[0], text: pair[1] });
      })
    );
    sort.addEventListener('change', function () {
      state.sort = sort.value;
      state.dir = sort.value === 'name' || sort.value === 'category' ? 1 : -1;
      writeHash();
      renderView();
    });
    ui.sort = sort;

    var statusButtons = STATUSES.map(function (value) {
      var button = el('button', { type: 'button', 'aria-pressed': state.status === value ? 'true' : 'false', text: value === 'all' ? 'All' : value === 'watchlist' ? 'Watchlist' : 'Early' });
      button.addEventListener('click', function () { state.status = value; writeHash(); renderView(); });
      button.dataset.status = value;
      return button;
    });
    ui.statusButtons = statusButtons;

    var reset = el('button', { class: 'button subtle reset', type: 'button', text: 'Reset' });
    reset.addEventListener('click', function () {
      state.q = '';
      state.category = 'all';
      state.status = 'all';
      state.sort = 'implied';
      state.dir = -1;
      state.tab = 'pre';
      writeHash();
      renderView();
    });

    var count = el('span', { class: 'count' });
    ui.count = count;

    var statusField = el('div', { class: 'field' }, el('span', { class: 'label', text: 'Scope' }), el('div', { class: 'seg' }, statusButtons));
    ui.statusField = statusField;
    var sortField = el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sort);
    ui.sortField = sortField;

    return el('section', { class: 'controls panel' },
      el('div', { class: 'control-row' },
        el('div', { class: 'tabs' }, preTab, liveTab),
        el('div', { class: 'field search-field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), category)
      ),
      el('div', { class: 'control-row' }, statusField, sortField, el('div', { class: 'control-spacer' }), reset, count)
    );
  }

  function fillCategories(kind) {
    if (ui.categoryKind === kind) return;
    ui.categoryKind = kind;
    var list = kind === 'live' ? liveCategories : preCategories;
    ui.category.textContent = '';
    ui.category.appendChild(el('option', { value: 'all', text: 'All categories' }));
    list.forEach(function (name) { ui.category.appendChild(el('option', { value: name, text: name })); });
  }

  function syncControls() {
    if (state.tab === 'live' && state.category !== 'all' && liveCategories.indexOf(state.category) < 0) state.category = 'all';
    if (state.tab === 'pre' && state.category !== 'all' && preCategories.indexOf(state.category) < 0) state.category = 'all';
    ui.preTab.setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
    ui.liveTab.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    if (ui.search.value !== state.q) ui.search.value = state.q;
    fillCategories(state.tab === 'live' ? 'live' : 'pre');
    if (ui.category.value !== state.category) ui.category.value = state.category;
    ui.statusField.hidden = state.tab !== 'pre';
    ui.sortField.hidden = state.tab !== 'pre';
    if (ui.sort.value !== state.sort) ui.sort.value = state.sort;
    ui.statusButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.status === state.status ? 'true' : 'false');
    });
  }

  function activeFilters() {
    var tags = [];
    if (state.q) tags.push(chip('Search: ' + state.q));
    if (state.category !== 'all') tags.push(chip('Category: ' + state.category));
    if (state.tab === 'pre' && state.status !== 'all') tags.push(chip('Scope: ' + (state.status === 'watchlist' ? 'watchlist only' : 'early only'), true));
    if (state.tab === 'pre' && (state.sort !== 'implied' || state.dir !== -1)) tags.push(chip('Sort: ' + sortLabel(state.sort) + (state.dir < 0 ? ' ↓' : ' ↑')));
    return tags.length === 0 ? null : el('div', { class: 'active-filters' }, tags);
  }
  function chip(text, gold) {
    return el('span', { class: 'chip' + (gold ? ' gold' : ''), text: text });
  }

  function viewHead(title, shown, total, noun, sortText) {
    return el('div', { class: 'view-head' },
      el('div', null,
        el('h2', { text: title }),
        el('p', { class: 'filter-summary' }, 'Showing ', el('b', { text: String(shown) }), ' of ', el('b', { text: String(total) }), ' ' + noun + ' · ' + sortText),
        activeFilters()
      )
    );
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    var aria = active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none';
    var suffix = active ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return el('th', { scope: 'col', 'aria-sort': aria },
      el('button', { type: 'button', onclick: function () { setSort(key); } }, label + suffix)
    );
  }

  function statusTags(row) {
    return el('div', { class: 'tag-row' },
      el('span', { class: 'tag ' + (row.watchlist ? 'watch' : 'early'), text: row.watchlist ? 'Watchlist' : 'Early' }),
      el('span', { class: 'tag muted', text: 'No token recorded' })
    );
  }

  function preTable(list) {
    if (list.length === 0) return emptyState('No pre-token protocol matches that filter.', 'Clear the search or pick another category to see the board again.');
    var max = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (row) {
      var width = Math.max(3, Math.round((row.implied_value_usd / max) * 100));
      var chains = row.chains && row.chains.length > 0 ? row.chains.slice(0, 3).join(', ') : 'an unnamed chain';
      var tr = el('tr', {
        'data-selected': state.selected === row.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(row.slug); },
        onkeydown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetail(row.slug);
          }
        }
      },
        el('td', { class: 'rank' }, el('b', { text: String(row.rank) })),
        el('td', null, el('div', { class: 'protocol' }, el('b', { text: row.name }), el('span', { class: 'sub', text: categoryKey(row) + ' · ' + chains }))),
        el('td', null, statusTags(row)),
        el('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
        el('td', { class: 'num ' + growthClass(row.change_7d), text: fmtPct(row.change_7d) }),
        el('td', { class: 'num', text: fmtAge(row.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + width + '%' })),
          el('span', { class: 'value', text: fmtUsd(row.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'momentum ' + row.momentum, text: row.momentum }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Rank is the model\u2019s implied-value rank; sorting or filtering reorders the view without changing it. Select any row for its inputs and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Status' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Momentum' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable(list) {
    if (list.length === 0) return emptyState('No live-token protocol matches that filter.', 'Clear the search or pick another category to see the live-token leaders.');
    var tbody = el('tbody');
    list.forEach(function (row) {
      var chains = row.chains && row.chains.length > 0 ? row.chains.slice(0, 3).join(', ') : 'an unnamed chain';
      tbody.appendChild(el('tr', { class: 'live-row' },
        el('td', null, el('div', { class: 'protocol' }, el('b', { text: row.name }), el('span', { class: 'sub', text: categoryKey(row) + ' · ' + chains }))),
        el('td', null, el('span', { class: 'tag muted', text: categoryKey(row) })),
        el('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
        el('td', { class: 'num ' + growthClass(row.change_7d), text: fmtPct(row.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(row.mcap_usd) }),
        el('td', null, row.symbol ? el('span', { class: 'tag', text: row.symbol }) : el('span', { class: 'sub dim', text: 'n/a' })),
        el('td', null, el('span', { class: 'tag live', text: 'Already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token-bearing protocols are set aside from the pre-token ranking. Their market cap is the snapshot\u2019s recorded fact, not a model estimate.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Symbol' }),
            el('th', { scope: 'col', text: 'Token status' })
          )),
          tbody
        )
      )
    );
  }

  function emptyState(title, text) {
    var button = el('button', { class: 'button primary', type: 'button', text: 'Clear filters' });
    button.addEventListener('click', function () {
      state.q = '';
      state.category = 'all';
      state.status = 'all';
      writeHash();
      renderView();
    });
    return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('h2', { text: title }), el('p', { text: text }), button));
  }

  function methodPanel() {
    var m = DATA.model;
    return el('section', { class: 'method panel', id: 'method' },
      el('div', null,
        el('h2', { text: 'One model, stated in full' }),
        el('p', { class: 'sub', text: 'No row is hand-picked and no protocol name is special-cased. The same function scores the watchlist and every early row below the floor.' }),
        el('div', { class: 'formula', text: 'implied = round( tvl_usd × ' + m.base_multiple + ' × (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + ') × (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + ') )' }),
        el('p', { class: 'note', text: 'The page recomputes every row from the snapshot and compares it with board.json. The detail view reports a match or a mismatch instead of hiding it. No live data is fetched.' }),
        el('div', { class: 'legend' },
          el('span', { class: 'tag watch', text: 'Watchlist' }),
          el('span', { class: 'tag early', text: 'Early' }),
          el('span', { class: 'tag muted', text: 'No token recorded' }),
          el('span', { class: 'tag live', text: 'Already trades' })
        )
      ),
      el('div', null,
        el('h3', { text: 'Definitions' }),
        el('dl', { class: 'definition-list' },
          definition('TVL', 'Whole-dollar TVL from the frozen DefiLlama snapshot, truncated at the source.'),
          definition('Seven-day growth', 'The reported change, clamped to the model floor and cap so one volatile week cannot dominate the board.'),
          definition('Age', 'Days since DefiLlama began tracking the protocol; unreported dates use the ' + m.unknown_age_days + '-day fallback. It stands in for how long the protocol has run with no token on record.'),
          definition('No token recorded', 'Market cap, CoinGecko id and symbol are all null. The snapshot\u2019s record is not proof that no token exists.'),
          definition('Watchlist floor', 'The house list of protocols at or above ' + fmtUsd(DATA.floor_usd) + ' TVL with no token recorded and no wrapped, staked or bridged marker. The board covers all ' + DATA.watchlist_size + ' and adds ' + DATA.early_size + ' early rows below the floor.'),
          definition('Live tokens', 'Token-bearing protocols are never mixed into the ranked board; the Live tokens tab shows their recorded market caps.')
        )
      )
    );
  }
  function definition(term, text) {
    return el('div', null, el('dt', { text: term }), el('dd', { text: text }));
  }

  function footer() {
    return el('footer', null,
      el('div', null, el('b', { text: 'Token Radar' }), ' · token-radar-01 · frozen snapshot ' + DATA.as_of + ' · ' + DATA.model_version),
      el('div', null, 'Implied values are model estimates, not prices or financial advice. The dataset is the sealed DefiLlama snapshot.')
    );
  }

  function parseStep(step) {
    var costAt = step.indexOf(' Cost: ');
    var timeAt = costAt >= 0 ? step.indexOf('. Time: ', costAt) : -1;
    if (costAt >= 0 && timeAt > costAt) {
      return {
        action: step.slice(0, costAt),
        cost: step.slice(costAt + 7, timeAt),
        time: step.slice(timeAt + 8).replace(/\.$/, '')
      };
    }
    return { action: step, cost: '', time: '' };
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (item) { return item.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    var m = DATA.model;
    var recomputed = recompute(row);
    var check = recomputed === row.implied_value_usd;
    var growthWasClamped = row.change_7d !== null && row.change_7d !== undefined && row.growth_pct !== row.change_7d;
    var growthSentence = row.change_7d === null
      ? 'No seven-day change is reported, so the growth factor is 1.0×.'
      : 'The seven-day change is ' + fmtPct(row.change_7d) + (growthWasClamped ? ', clamped to ' + fmtPct(row.growth_pct) + ' by the model' : '') + ', for a growth factor of ' + row.growth_multiplier + '×.';
    var ageSentence = row.age_days === null
      ? 'Its listing date is unreported, so the model uses the ' + m.unknown_age_days + '-day fallback.'
      : 'It has been listed since ' + row.listed_at + ' (' + fmtAge(row.age_days) + ') with no token on record, for a maturity factor of ' + row.maturity_multiplier + '×.';
    var why = 'Rank ' + row.rank + ' of ' + DATA.board_size + '. The snapshot records ' + fmtFull(row.tvl_usd) + ' of TVL, so the base is ' + fmtFull(row.base_value_usd) + '. ' + growthSentence + ' ' + ageSentence + ' That gives ' + fmtFull(row.base_value_usd) + ' × ' + row.growth_multiplier + ' × ' + row.maturity_multiplier + ' = ' + fmtFull(row.implied_value_usd) + '. The model does not predict whether or when a token launches.';

    var close = el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close' });
    close.addEventListener('click', function () { dialog.close(); });

    dialog.appendChild(el('div', { class: 'detail-shell' },
      el('div', { class: 'detail-top' },
        el('div', null,
          el('p', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'Watchlist' : 'Early radar') }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: categoryKey(row) + ' on ' + (row.chains && row.chains.length > 0 ? row.chains.join(', ') : 'an unnamed chain') })
        ),
        close
      ),
      el('div', { class: 'detail-tags' },
        el('span', { class: 'tag ' + (row.watchlist ? 'watch' : 'early'), text: row.watchlist ? 'Watchlist' : 'Early below floor' }),
        el('span', { class: 'tag muted', text: 'No token recorded' }),
        el('span', { class: 'tag', text: 'Age: ' + row.age_band }),
        el('span', { class: 'tag', text: row.momentum })
      ),
      el('div', { class: 'detail-value' },
        el('span', { text: 'Implied value · ' + DATA.model_version }),
        el('strong', { text: fmtUsd(row.implied_value_usd) }),
        el('small', { text: 'An estimate from the frozen snapshot, not a price, market cap, or promise of a launch.' })
      ),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'card' },
          el('h3', { text: 'Model inputs' }),
          el('dl', { class: 'equation' },
            equation('TVL (snapshot)', fmtFull(row.tvl_usd)),
            equation('Base value (TVL × ' + m.base_multiple + ')', fmtFull(row.base_value_usd)),
            equation('Seven-day change', fmtPct(row.change_7d) + (growthWasClamped ? ' → ' + fmtPct(row.growth_pct) : '')),
            equation('Growth multiplier', row.growth_multiplier + '×'),
            equation('Age since listing', row.age_days === null ? 'unreported → ' + m.unknown_age_days + 'd' : fmtAge(row.age_days)),
            equation('Maturity multiplier', row.maturity_multiplier + '×'),
            equation('Implied value', fmtFull(row.implied_value_usd), true)
          ),
          el('p', { class: 'note' }, 'Page recomputes ', el('code', { text: fmtFull(recomputed) }), check ? ', matching board.json.' : ', which differs from board.json; the data would be stale.')
        ),
        el('div', { class: 'card' },
          el('h3', { text: 'Why this ranks here' }),
          el('p', { class: 'why-text', text: why }),
          el('ul', { class: 'flags' },
            el('li', { text: 'No token recorded: market cap, CoinGecko id and symbol are all null in the snapshot.' }),
            el('li', { text: row.watchlist ? 'Watchlist row: TVL at or above the house floor with no token recorded.' : 'Early row: below the watchlist floor, ranked by the same model rather than a hand-kept list.' }),
            el('li', { text: 'Age band: ' + row.age_band + '; seven-day momentum: ' + row.momentum + '.' }),
            el('li', { text: 'Snapshot ' + DATA.as_of + '; no live data is fetched by this page.' })
          )
        )
      ),
      el('section', { class: 'plan' },
        el('div', { class: 'plan-head' },
          el('h3', { text: 'Farm plan' }),
          el('span', { text: row.farm_steps.length + ' concrete steps · cost and time on every step' })
        ),
        el('ol', { class: 'steps' }, row.farm_steps.map(function (step, index) {
          var parsed = parseStep(step);
          return el('li', null,
            el('div', { class: 'step-num', text: String(index + 1).padStart(2, '0') }),
            el('div', { class: 'step-body' },
              el('b', { text: parsed.action }),
              el('div', { class: 'step-meta' },
                parsed.cost ? el('span', { text: 'Cost: ' + parsed.cost }) : null,
                parsed.time ? el('span', { class: 'time', text: 'Time: ' + parsed.time }) : null
              )
            )
          );
        }))
      ),
      el('div', { class: 'disclaimer' },
        el('b', { text: 'Records are not proof. ' }),
        'DefiLlama records no token for this protocol; that is not proof it has none. Confirm announcements on the protocol\u2019s own channels, never pay an upfront claim fee, and treat the implied value as a model estimate, not financial advice.'
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else if (!dialog.hasAttribute('open')) {
      dialog.setAttribute('open', '');
    }
  }
  function equation(term, value, total) {
    return el('div', total ? { class: 'total' } : null, el('dt', { text: term }), el('dd', { text: value }));
  }

  function renderView() {
    syncControls();
    ui.boardSlot.textContent = '';
    if (state.tab === 'pre') {
      var list = sortedPre(filteredPre());
      var direction = state.dir < 0 ? 'high to low' : 'low to high';
      ui.boardSlot.appendChild(viewHead('Pre-token board', list.length, DATA.rows.length, 'pre-token protocols', sortLabel(state.sort) + ', ' + direction));
      ui.boardSlot.appendChild(preTable(list));
      ui.count.textContent = list.length + ' / ' + DATA.rows.length + ' rows';
    } else {
      var live = filteredLive();
      ui.boardSlot.appendChild(viewHead('Live-token leaders', live.length, DATA.live.length, 'token-bearing protocols shown', 'market cap, high to low'));
      ui.boardSlot.appendChild(liveTable(live));
      ui.count.textContent = live.length + ' / ' + DATA.live.length + ' rows';
    }
  }

  function buildShell() {
    var shell = el('div', { class: 'shell' },
      header(),
      hero(),
      methodStrip(),
      controlsPanel()
    );
    ui.boardSlot = el('div', { class: 'board-slot' });
    shell.appendChild(ui.boardSlot);
    shell.appendChild(methodPanel());
    shell.appendChild(footer());
    app.textContent = '';
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  buildShell();
  renderView();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.open) dialog.close();
  });
})();
