(() => {
  const root = document.createElement('div');
  root.id = 'referenceSurface';
  document.body.appendChild(root);
  const W = 1829, H = 1020;
  const pct = (v, total) => `${(v / total) * 100}%`;

  function hit(area, label, action, inactive = false) {
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.type = 'button';
    el.setAttribute('aria-label', label);
    el.style.left = pct(area[0], W);
    el.style.top = pct(area[1], H);
    el.style.width = pct(area[2], W);
    el.style.height = pct(area[3], H);
    if (inactive) el.style.cursor = 'default';
    el.addEventListener('click', action);
    root.appendChild(el);
    return el;
  }

  function go(page) {
    state.page = page;
    state.payStep = 0;
    draw();
  }

  function image(name) {
    root.innerHTML = `<img class="reference-image" src="assets/${name}" alt="">`;
  }

  function addHeaderLinks() {
    hit([269, 10, 45, 42], 'Open navigation', () => go(state.page === 'payment' ? 'account' : 'home'));
    hit([1595, 12, 90, 42], 'Home', () => go('home'));
  }

  function drawDashboard() {
    image('dashboard-reference.png');
    addHeaderLinks();
    hit([282, 108, 354, 159], 'Student account', () => go('account'));
    hit([673, 108, 355, 159], 'Academic planning', () => go('academic'));
    hit([1064, 108, 355, 159], 'Resumption', () => go('resumption'));
    hit([1455, 108, 355, 62], 'Student affairs', () => go('affairs'));
    hit([1455, 205, 355, 160], 'Course control', () => go('course'));
    hit([282, 400, 355, 160], 'Attendance', () => go('attendance'));
    hit([673, 400, 355, 160], 'Result processing', () => go('results'));
  }

  function drawAccount() {
    image('account-reference.png');
    addHeaderLinks();
    hit([27, 242, 185, 39], 'Make Payments', () => go('payment'));
    hit([27, 288, 185, 39], 'Receipt', () => go('receipt'));
  }

  function drawPayment() {
    image('payment-reference.png');
    addHeaderLinks();
    hit([497, 76, 465, 36], 'View statement of account', () => go('statement'));

    const choices = [
      ['CUPIN', [296, 412, 300, 44], [303, 427]],
      ['Interswitch', [727, 412, 400, 44], [734, 427]],
      ['Paystack Card', [296, 459, 325, 44], [303, 474]],
      ['Paystack Others', [727, 459, 400, 44], [734, 474]],
    ];
    for (const [name, area, dot] of choices) {
      hit(area, `Select ${name}`, () => { state.method = name; draw(); });
      if (state.method === name) {
        const marker = document.createElement('span');
        marker.className = 'choice-dot';
        marker.style.left = pct(dot[0], W);
        marker.style.top = pct(dot[1], H);
        root.appendChild(marker);
      }
    }
    hit([1038, 716, 112, 44], 'Proceed to payment details', () => {
      if (state.method) { state.payStep = 1; draw(); }
    }, !state.method);
  }

  function header() {
    return '<div class="prototype-header">♟ Osarenkhoe &nbsp;⌄ &nbsp;&nbsp;&nbsp;⌂ Home &nbsp; / &nbsp; Student Account</div>';
  }

  function drawReview() {
    const isPaystack = ['Paystack Card', 'Paystack Others'].includes(state.method);
    const message = isPaystack
      ? 'You will complete payment on Paystack’s secure checkout. This portal does not collect or store card details.'
      : `${state.method || 'This payment method'} is not connected yet. Choose Paystack Card or Paystack Others to make a real payment.`;
    root.innerHTML = `${header()}<main class="prototype-main"><section class="prototype-card"><div class="prototype-title">Payment Details</div><div class="prototype-body"><p>Selected payment method: <strong>${state.method || 'None'}</strong></p><label>Email for your Paystack receipt<br><input id="payerEmail" type="email" autocomplete="email" maxlength="254" required ${isPaystack ? '' : 'disabled'}></label><label>Amount to pay (₦)<br><input id="paymentAmount" type="number" min="100" max="595997" step="1" value="595997" required ${isPaystack ? '' : 'disabled'}></label><div class="notice">${message}</div><p id="paymentStatus" role="status" aria-live="polite"></p><button id="reviewBack">Back</button> <button class="primary" id="startPay" ${isPaystack ? '' : 'disabled'}>Continue to Paystack</button></div></section></main>`;
    root.querySelector('#reviewBack').onclick = () => { state.payStep = 0; draw(); };
    const startPay = root.querySelector('#startPay');
    startPay.onclick = async () => {
      const email = root.querySelector('#payerEmail');
      const amount = root.querySelector('#paymentAmount');
      const status = root.querySelector('#paymentStatus');
      if (!email.reportValidity() || !amount.reportValidity()) return;

      startPay.disabled = true;
      status.textContent = 'Connecting securely to Paystack…';
      try {
        const response = await fetch('/api/payments/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.value, amountNaira: Number(amount.value), method: state.method }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not start the payment.');
        window.location.assign(result.authorizationUrl);
      } catch (error) {
        status.textContent = error.message || 'Could not start the payment. Please try again.';
        startPay.disabled = false;
      }
    };
  }

  function drawOther() {
    root.innerHTML = `${header()}<main class="prototype-main"><section class="prototype-card"><div class="prototype-title">${state.page[0].toUpperCase()}${state.page.slice(1)}</div><div class="prototype-body"><p>This tab is clickable. Share its reference screenshot and I’ll match the page.</p><button id="homeBack" class="primary">Home</button></div></section></main>`;
    root.querySelector('#homeBack').onclick = () => go('home');
  }

  function drawStatement() {
    root.innerHTML = `${header()}<main class="prototype-main"><section class="prototype-card"><div class="prototype-title">Statement of Account</div><div class="prototype-body"><table><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody><tr><td>Sample</td><td>Opening balance</td><td>—</td><td>—</td><td>₦127,905</td></tr><tr><td>Sample</td><td>School fees and charges</td><td>₦1,871,575</td><td>—</td><td>₦1,999,480</td></tr><tr><td>Sample</td><td>Payments received</td><td>—</td><td>₦1,403,483</td><td>₦595,997</td></tr></tbody></table><div class="notice">Illustrative entries only; no official student account data is connected.</div><button id="paymentBack" class="primary">Make Payment</button></div></section></main>`;
    root.querySelector('#paymentBack').onclick = () => go('payment');
  }

  function drawReceipt() {
    const details = state.receipt
      ? `<div class="success">✓</div><h2>Payment verified</h2><p>Reference: <strong>${state.receipt.reference}</strong></p><p>Student: ${STUDENT_LABEL}</p><p>Method: ${state.receipt.method}${state.receipt.channel ? ` (${state.receipt.channel})` : ''}</p><p>Amount: ₦${Number(state.receipt.amountNaira).toLocaleString('en-NG')}</p><p>Email: ${state.receipt.email}</p><p>Date: ${new Date(state.receipt.date).toLocaleString('en-NG')}</p><div class="notice">Paystack confirmed this transaction as successful.</div>`
      : `<p>${state.paymentMessage || 'No verified payment receipt yet.'}</p>${state.paymentMessage ? '<div class="notice">No payment was recorded by this portal.</div>' : ''}`;
    root.innerHTML = `${header()}<main class="prototype-main"><section class="prototype-card"><div class="prototype-title">Payment Receipt</div><div class="prototype-body">${details}<button id="receiptPay" class="primary">Make Payment</button></div></section></main>`;
    root.querySelector('#receiptPay').onclick = () => go('payment');
  }

  const STUDENT_LABEL = 'Osarenkhoe Osamudiamen · 22CK031380';

  async function handlePaymentReturn() {
    const query = new URLSearchParams(window.location.search);
    const outcome = query.get('payment');
    if (!outcome) return;

    const reference = query.get('reference');
    window.history.replaceState({}, '', window.location.pathname);
    state.page = 'receipt';
    state.payStep = 0;
    state.receipt = null;
    state.paymentMessage = outcome === 'failed'
      ? 'Paystack did not confirm a successful payment. You can try again.'
      : '';

    if (outcome === 'success' && reference) {
      try {
        const response = await fetch(`/api/payments/receipt?reference=${encodeURIComponent(reference)}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Receipt not found.');
        state.receipt = result.receipt;
      } catch (error) {
        state.paymentMessage = `Payment could not be verified by this portal: ${error.message}`;
      }
    }
    draw();
  }

  function draw() {
    if (state.page === 'home') return drawDashboard();
    if (state.page === 'account') return drawAccount();
    if (state.page === 'payment' && state.payStep === 0) return drawPayment();
    if (state.page === 'payment') return drawReview();
    if (state.page === 'statement') return drawStatement();
    if (state.page === 'receipt') return drawReceipt();
    return drawOther();
  }

  draw();
  handlePaymentReturn();
})();
