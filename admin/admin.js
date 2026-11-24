// Ankveda admin — plain JS, talks to the API through the Firebase Hosting rewrite (/api/**).
(() => {
  // Production = Firebase Cloud Functions behind this Hosting site; Staging = Vercel.
  const ENVIRONMENTS = {
    production: { label: 'Production', api: '/api' },
    staging: { label: 'Staging', api: 'https://ankveda-api-staging.vercel.app/api' },
  };
  const ENV_KEY = 'ankveda.admin.env';
  const $ = (sel) => document.querySelector(sel);

  let env = localStorage.getItem(ENV_KEY) in ENVIRONMENTS ? localStorage.getItem(ENV_KEY) : 'production';
  let API = ENVIRONMENTS[env].api;
  // Each environment has its own JWT secret, so keep one admin session per environment.
  const tokenKey = () => `ankveda.admin.token.${env}`;
  let token = sessionStorage.getItem(tokenKey());

  const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const date = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const periodLabel = (p) => `${p.interval > 1 ? `${p.interval} ` : ''}${{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[p.period]}${p.interval > 1 ? 's' : ''}`;

  const request = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/admin/login') {
      signOut();
      throw new Error('Session expired. Please sign in again.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  /** Builds a table safely (textContent only — user data is never injected as HTML). */
  const renderTable = (table, headers, rows) => {
    table.replaceChildren();
    const head = table.createTHead().insertRow();
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    });
    const body = table.createTBody();
    if (rows.length === 0) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = headers.length;
      cell.textContent = 'Nothing here yet.';
      return;
    }
    rows.forEach((cells) => {
      const tr = body.insertRow();
      cells.forEach((value) => {
        const td = tr.insertCell();
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = value ?? '—';
      });
    });
  };

  const badge = (on, label) => {
    const span = document.createElement('span');
    span.className = `badge${on ? ' on' : ''}`;
    span.textContent = label;
    return span;
  };

  const actionButton = (label, onClick) => {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await onClick();
      } catch (e) {
        alert(e.message);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };

  const loadPlans = async () => {
    const { plans, razorpayConfigured } = await request('GET', '/admin/plans');
    $('#razorpay-notice').hidden = razorpayConfigured;
    renderTable(
      $('#plans-table'),
      ['Name', 'Price', 'Every', 'Trial', 'Featured', 'Active', 'Razorpay plan', 'Actions'],
      plans.map((p) => {
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';
        if (!p.featured) actions.appendChild(actionButton('Feature', () => updatePlan(p.id, { featured: true, active: true })));
        actions.appendChild(actionButton(p.active ? 'Deactivate' : 'Activate', () => updatePlan(p.id, { active: !p.active })));
        return [
          p.name,
          rupees(p.priceInPaise),
          periodLabel(p),
          p.trialDays > 0 ? `${p.trialDays} days · ${p.trialPriceInPaise > 0 ? rupees(p.trialPriceInPaise) : 'free'}` : '—',
          badge(p.featured, p.featured ? 'Featured' : 'No'),
          badge(p.active, p.active ? 'Active' : 'Off'),
          p.razorpayPlanId,
          actions,
        ];
      }),
    );
  };

  const updatePlan = async (id, patch) => {
    await request('PATCH', `/admin/plans/${encodeURIComponent(id)}`, patch);
    await loadPlans();
  };

  const loadUsers = async () => {
    const { users } = await request('GET', '/admin/users');
    renderTable(
      $('#users-table'),
      ['Name', 'Phone', 'Date of birth', 'Premium', 'Status', 'Joined'],
      users.map((u) => [u.fullName, `+91 ${u.phone}`, u.dob, badge(u.premium, u.premium ? 'Yes' : 'No'), u.status, date(u.createdAt)]),
    );
  };

  const loadSubscriptions = async () => {
    const { subscriptions } = await request('GET', '/admin/subscriptions');
    renderTable(
      $('#subs-table'),
      ['Razorpay id', 'Plan', 'Status', 'Period ends', 'Cancels', 'Created'],
      subscriptions.map((s) => [s.id, s.planName, s.status, date(s.currentPeriodEnd), s.cancelAtPeriodEnd ? 'At period end' : '—', date(s.createdAt)]),
    );
  };

  const loadPayments = async () => {
    const { payments } = await request('GET', '/admin/payments');
    renderTable(
      $('#payments-table'),
      ['Razorpay payment', 'Amount', 'Kind', 'Status', 'Method', 'Subscription', 'Paid at'],
      payments.map((p) => [p.id, rupees(p.amountInPaise), p.kind, p.status, p.method, p.subscriptionId, date(p.paidAt)]),
    );
  };

  const loaders = { plans: loadPlans, users: loadUsers, subscriptions: loadSubscriptions, payments: loadPayments };

  const showTab = (name) => {
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
    loaders[name]().catch((e) => alert(e.message));
  };

  const showApp = () => {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#logout').hidden = false;
    showTab('plans');
  };

  const signOut = () => {
    token = null;
    sessionStorage.removeItem(tokenKey());
    $('#login-view').hidden = false;
    $('#app-view').hidden = true;
    $('#logout').hidden = true;
  };

  // Live preview of how the paywall will describe the plan.
  const planForm = $('#plan-form');
  const readPlan = () => {
    const f = new FormData(planForm);
    return {
      name: String(f.get('name') || '').trim(),
      description: String(f.get('description') || '').trim() || undefined,
      priceInPaise: Math.round(Number(f.get('price')) * 100),
      period: String(f.get('period')),
      interval: Number(f.get('interval')),
      trialDays: Number(f.get('trialDays') || 0),
      trialPriceInPaise: Math.round(Number(f.get('trialPrice') || 0) * 100),
      featured: f.get('featured') === 'on',
      active: f.get('active') === 'on',
    };
  };
  const updatePreview = () => {
    const p = readPlan();
    if (!p.priceInPaise) {
      $('#plan-preview').textContent = '';
      return;
    }
    const recurring = `${rupees(p.priceInPaise)} / ${periodLabel(p)}`;
    $('#plan-preview').textContent =
      p.trialDays > 0
        ? `Paywall: “${p.trialDays} day Trial · ${p.trialPriceInPaise > 0 ? rupees(p.trialPriceInPaise) : 'Free'} — After that ${recurring}”`
        : `Paywall: “${p.name || 'Plan'} · ${recurring}”`;
  };
  planForm.addEventListener('input', updatePreview);

  planForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = planForm.querySelector('button[type="submit"]');
    $('#plan-error').textContent = '';
    button.disabled = true;
    try {
      await request('POST', '/admin/plans', readPlan());
      planForm.reset();
      updatePreview();
      await loadPlans();
    } catch (err) {
      $('#plan-error').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      const { token: t } = await request('POST', '/admin/login', { password: new FormData(e.target).get('password') });
      token = t;
      sessionStorage.setItem(tokenKey(), t);
      e.target.reset();
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  document.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('#logout').addEventListener('click', signOut);

  // Environment switch: re-points the API and swaps to that environment's session.
  const envSelect = $('#env');
  envSelect.value = env;
  envSelect.addEventListener('change', () => {
    env = envSelect.value;
    API = ENVIRONMENTS[env].api;
    localStorage.setItem(ENV_KEY, env);
    token = sessionStorage.getItem(tokenKey());
    if (token) showApp();
    else signOut();
  });

  if (token) showApp();
})();
