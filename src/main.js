import Chart from 'chart.js/auto';
import './style.css';
import { simulate, standaloneLoanCost } from './simulation.js';

// --- Static DOM Elements ---
const payoffTimeEl = document.getElementById('payoffTime');
const totalInterestEl = document.getElementById('totalInterest');
const initialContractualPaymentEl = document.getElementById('initialContractualPayment');
const totalOverpaymentsEl = document.getElementById('totalOverpayments');
const errorMessageEl = document.getElementById('error-message');
const infoMessageEl = document.getElementById('info-message');
const modeComparisonEl = document.getElementById('mode-comparison');
const consolidationAmountInput = document.getElementById('consolidationAmount');
const consolidationRateInput = document.getElementById('consolidationRate');
const consolidationTermInput = document.getElementById('consolidationTerm');
const consolidationPanelEl = document.getElementById('consolidation-panel');
const compareToggle = document.getElementById('compareToggle');
const mortgageBSummaryEl = document.getElementById('mortgage-b-summary');
const mortgageBHintEl = document.getElementById('mortgage-b-hint');
const mortgageBFormEl = document.getElementById('mortgage-b');

let payoffChart = null;
let mortgageA = null;
let mortgageB = null;

const gbp = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const gbpWhole = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const formatPayoff = months => `${Math.floor(months / 12)} years, ${months % 12} months`;

function formatDuration(months) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
    if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
    return parts.join(', ') || '0 months';
}

// Contractual payment in force during the loan's final fixed period
// (constant within a period, so the last schedule row carries it)
function finalPeriodContractual(result) {
    return result.schedule[result.months - 1].contractual;
}

// --- Mortgage Input Panel ---
// Both mortgage columns render from this single template so they stay identical.

function mortgageFormHTML(prefix) {
    const input = 'border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500';
    return `
        <fieldset>
            <legend class="text-lg font-medium text-gray-900">Loan Details</legend>
            <div class="space-y-6 mt-4">
                <div>
                    <label for="${prefix}-principal" class="block text-sm font-medium text-gray-700 mb-1">Total Principal</label>
                    <div class="relative">
                        <span class="absolute left-0 top-0 h-full pl-4 flex items-center text-gray-400">£</span>
                        <input type="number" id="${prefix}-principal" value="844000" class="principal-input w-full pl-10 px-4 py-2 ${input}">
                    </div>
                </div>
                <div>
                    <label for="${prefix}-term" class="block text-sm font-medium text-gray-700 mb-1">Full Mortgage Term</label>
                    <div class="relative">
                        <input type="number" id="${prefix}-term" value="37" class="term-input w-full pr-10 px-4 py-2 ${input}">
                        <span class="absolute right-0 top-0 h-full pr-4 flex items-center text-gray-400">Years</span>
                    </div>
                </div>
                <div>
                    <label for="${prefix}-payment" class="block text-sm font-medium text-gray-700 mb-1">Payment Amount</label>
                    <div class="relative">
                        <span class="absolute left-0 top-0 h-full pl-4 flex items-center text-gray-400">£</span>
                        <input type="number" id="${prefix}-payment" value="4000" class="payment-input w-full pl-10 px-4 py-2 ${input}">
                    </div>
                </div>
                <div>
                    <label for="${prefix}-full-repayment" class="block text-sm font-medium text-gray-700 mb-1">Repay in Full at End of Fix</label>
                    <select id="${prefix}-full-repayment" class="full-repayment w-full px-4 py-2 bg-white ${input}"></select>
                    <p class="mt-1 text-xs text-gray-500">At the end of a fixed period the mortgage can be cleared without an early repayment charge, so the 10% cap doesn't apply.</p>
                </div>
            </div>
        </fieldset>

        <fieldset class="border-t border-gray-200 pt-6">
            <legend class="text-lg font-medium text-gray-900">Overpayment Effect</legend>
            <p class="mt-1 text-sm text-gray-500">How the lender recalculates the contractual payment at each rate change.</p>
            <div class="mt-4 space-y-3">
                <label class="flex items-start gap-3 cursor-pointer">
                    <input type="radio" name="${prefix}-overpaymentMode" value="reducePayment" checked class="mt-1 text-indigo-600 focus:ring-indigo-500">
                    <span class="text-sm">
                        <span class="font-medium text-gray-900">Reduce the payment</span><br>
                        <span class="text-gray-500">The contractual minimum falls over time — flexibility if income or rates change, and the loan can still be cleared at the end of any fixed period.</span>
                    </span>
                </label>
                <label class="flex items-start gap-3 cursor-pointer">
                    <input type="radio" name="${prefix}-overpaymentMode" value="reduceTerm" class="mt-1 text-indigo-600 focus:ring-indigo-500">
                    <span class="text-sm">
                        <span class="font-medium text-gray-900">Reduce the term</span><br>
                        <span class="text-gray-500">Pays off sooner, but the contractual minimum stays high for the whole life of the loan.</span>
                    </span>
                </label>
            </div>
        </fieldset>

        <fieldset class="border-t border-gray-200 pt-6 min-w-0">
            <legend class="text-lg font-medium text-gray-900">Interest Rate Schedule</legend>
            <p class="mt-1 text-sm text-gray-500">One line per fix: length, rate, and product fee (added to the loan at the start of the fix). The last line's terms carry forward, fee-free, until payoff.</p>
            <div class="mt-4 flex items-center gap-2 text-xs font-medium text-gray-500">
                <span class="w-16 shrink-0">Period</span>
                <span class="w-16 shrink-0">Months</span>
                <span class="flex-1">Rate %</span>
                <span class="w-20 shrink-0">Fee £</span>
                <span class="w-5 shrink-0"></span>
            </div>
            <div class="rate-periods mt-2 space-y-2"></div>
            <button type="button" class="add-rate mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-500">+ Add Rate Period</button>
        </fieldset>
    `;
}

function createMortgagePanel(formEl, prefix) {
    formEl.innerHTML = mortgageFormHTML(prefix);
    const principalInput = formEl.querySelector('.principal-input');
    const termInput = formEl.querySelector('.term-input');
    const paymentInput = formEl.querySelector('.payment-input');
    const repaySelect = formEl.querySelector('.full-repayment');
    const periodsDiv = formEl.querySelector('.rate-periods');
    const addBtn = formEl.querySelector('.add-rate');
    let repaymentOptionsKey = null;

    // Show each row's cumulative month range, derived from the durations above it
    function relabelRatePeriods() {
        let start = 0;
        Array.from(periodsDiv.children).forEach((row, index) => {
            const months = parseInt(row.querySelector('.months-input').value);
            const rangeEl = row.querySelector('.period-range');
            if (isNaN(months) || months < 1) {
                rangeEl.textContent = `#${index + 1}`;
            } else {
                rangeEl.textContent = `${start}–${start + months} mo`;
                start += months;
            }
        });
    }

    function addRatePeriod(months = '', rateValue = '', fee = '') {
        const inputClass = 'px-2 py-1 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500';
        const periodDiv = document.createElement('div');
        periodDiv.className = 'flex items-center gap-2';
        periodDiv.innerHTML = `
            <span class="period-range text-xs text-gray-500 w-16 shrink-0"></span>
            <input type="number" value="${months}" min="1" step="1" class="months-input w-16 shrink-0 ${inputClass}" placeholder="24" aria-label="Fix length in months">
            <input type="number" value="${rateValue}" step="0.01" class="rate-input flex-1 min-w-0 ${inputClass}" placeholder="5.5" aria-label="Interest rate in percent">
            <input type="number" value="${fee}" min="0" step="1" class="fee-input w-20 shrink-0 ${inputClass}" placeholder="999" aria-label="Product fee in pounds">
            <button type="button" class="remove-rate w-5 shrink-0 text-gray-400 hover:text-red-500 text-xl leading-none" title="Remove this rate period" aria-label="Remove this rate period">&times;</button>
        `;
        periodsDiv.appendChild(periodDiv);
        periodDiv.querySelector('.months-input').addEventListener('input', () => {
            relabelRatePeriods();
            runSimulation();
        });
        [periodDiv.querySelector('.rate-input'), periodDiv.querySelector('.fee-input')].forEach(input => {
            input.addEventListener('input', runSimulation);
        });
        periodDiv.querySelector('.remove-rate').addEventListener('click', () => {
            periodDiv.remove();
            relabelRatePeriods();
            runSimulation();
        });
        relabelRatePeriods();
    }

    // Reads the per-line schedule: {months, rate (decimal), fee}.
    // Returns null if any line is incomplete or invalid.
    function readRatePeriods() {
        const periods = [];
        for (const row of periodsDiv.children) {
            const months = parseInt(row.querySelector('.months-input').value);
            const rate = parseFloat(row.querySelector('.rate-input').value);
            const feeRaw = row.querySelector('.fee-input').value;
            const fee = feeRaw === '' ? 0 : parseFloat(feeRaw);
            if (isNaN(months) || months < 1 || isNaN(rate) || isNaN(fee) || fee < 0) return null;
            periods.push({ months, rate: rate / 100, fee });
        }
        return periods;
    }

    // Offer every fix boundary within the current term (entered periods, then
    // the last period's cadence carried forward), keeping the user's selection
    // when it's still valid.
    function syncFullRepaymentOptions(periods, termMonths) {
        const boundaries = [];
        let month = 0;
        for (const period of periods) {
            month += period.months;
            if (month >= termMonths) break;
            boundaries.push(month);
        }
        const lastMonths = periods[periods.length - 1].months;
        if (month < termMonths) {
            for (month += lastMonths; month < termMonths; month += lastMonths) {
                boundaries.push(month);
            }
        }

        const key = boundaries.join(',');
        if (repaymentOptionsKey === key) return;
        repaymentOptionsKey = key;
        const previous = repaySelect.value;
        repaySelect.innerHTML = '<option value="">No — run to payoff</option>';
        for (const boundary of boundaries) {
            const option = document.createElement('option');
            option.value = String(boundary);
            option.textContent = `After ${formatPayoff(boundary)}`;
            repaySelect.appendChild(option);
        }
        if (Array.from(repaySelect.options).some(o => o.value === previous)) {
            repaySelect.value = previous;
        }
    }

    function read() {
        const principal = parseFloat(principalInput.value);
        const termYears = parseInt(termInput.value);
        const paymentAmount = parseFloat(paymentInput.value) || 0;
        const ratePeriods = readRatePeriods();
        const overpaymentMode = formEl.querySelector(`input[name="${prefix}-overpaymentMode"]:checked`).value;

        if (isNaN(principal) || principal <= 0) return { error: "Invalid principal amount." };
        if (isNaN(termYears) || termYears <= 0) return { error: "Invalid term." };
        if (isNaN(paymentAmount) || paymentAmount <= 0) return { error: "Invalid payment amount." };
        if (periodsDiv.children.length === 0) return { error: "Please add at least one interest rate period." };
        if (ratePeriods === null) return { error: "Please fill in every rate period: length in months, rate, and fee (0 for none)." };

        syncFullRepaymentOptions(ratePeriods, termYears * 12);
        const fullRepaymentMonth = repaySelect.value === '' ? null : parseInt(repaySelect.value);
        return { inputs: { principal, termYears, paymentAmount, ratePeriods, fullRepaymentMonth }, overpaymentMode };
    }

    [principalInput, termInput, paymentInput].forEach(input => input.addEventListener('input', runSimulation));
    formEl.querySelectorAll(`input[name="${prefix}-overpaymentMode"]`).forEach(radio => {
        radio.addEventListener('change', runSimulation);
    });
    repaySelect.addEventListener('change', runSimulation);
    addBtn.addEventListener('click', () => {
        const lastRow = periodsDiv.lastElementChild;
        const lastMonths = lastRow ? parseInt(lastRow.querySelector('.months-input').value) : NaN;
        addRatePeriod(isNaN(lastMonths) || lastMonths < 1 ? 24 : lastMonths);
    });

    addRatePeriod(24, 4.64, 0);
    addRatePeriod(24, 4.29, 0);
    addRatePeriod(24, 3.94, 0);

    return { read };
}

// --- Simulation ---

function buildGraphData(result, principal) {
    // A null anchor at x=0 keeps every dataset index-aligned with the
    // principal series (which starts at the full principal), so the
    // tooltip's index mode shows the same month across all lines.
    const series = key => [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row[key] }))];
    const principalData = [
        { x: 0, y: principal },
        ...result.schedule.map(row => ({ x: row.month / 12, y: Math.max(0, row.balance) })),
    ];
    if (result.fullRepayment) {
        principalData.push({ x: result.fullRepayment.month / 12, y: 0 });
    }
    return {
        interest: series('interest'),
        payment: series('payment'),
        contractual: series('contractual'),
        principal: principalData,
    };
}

function runSimulation() {
    errorMessageEl.classList.add('hidden');
    infoMessageEl.classList.add('hidden');

    const a = mortgageA.read();
    if (a.error) { showError(a.error); return; }

    const reducePayment = simulate({ ...a.inputs, overpaymentMode: 'reducePayment' });
    const reduceTerm = simulate({ ...a.inputs, overpaymentMode: 'reduceTerm' });
    const result = a.overpaymentMode === 'reducePayment' ? reducePayment : reduceTerm;

    updateModeComparison(a.overpaymentMode, reducePayment, reduceTerm);
    updateConsolidationPanel(a.inputs, a.overpaymentMode, result);

    const infos = [];
    if (result.totalFees > 0) {
        infos.push(`Product fees totalling ${gbp(result.totalFees)} were added to the loan at the start of the fixed periods.`);
    }
    if (result.fullRepayment) {
        infos.push(`The remaining balance of ${gbp(result.fullRepayment.amount)} is repaid in full at the end of year ${result.fullRepayment.month / 12} — the end of a fixed period, so no early repayment charge applies.`);
    }
    if (result.paymentBelowContractual) {
        infos.push("Your payment is below the contractual monthly payment in one or more months; the contractual payment was paid instead.");
    }
    if (result.capHit) {
        infos.push("Your 10% annual overpayment cap was reached in one or more years. Payments were automatically reduced to stay within the limit.");
    }
    if (infos.length > 0) showInfo(infos.join(' '));

    // Mortgage B overlay
    let graphsB = null;
    mortgageBSummaryEl.classList.add('hidden');
    if (compareToggle.checked) {
        const b = mortgageB.read();
        if (b.error) {
            mortgageBSummaryEl.textContent = `Mortgage B: ${b.error}`;
            mortgageBSummaryEl.classList.remove('hidden');
        } else {
            const resultB = simulate({ ...b.inputs, overpaymentMode: b.overpaymentMode });
            graphsB = buildGraphData(resultB, b.inputs.principal);
            updateMortgageBSummary(resultB, result);
        }
    }

    updateUI(result, buildGraphData(result, a.inputs.principal), graphsB);
}

// --- UI Update Functions ---

function totalOutlay(result) {
    const payments = result.schedule.reduce((sum, row) => sum + row.payment, 0);
    return payments + (result.fullRepayment ? result.fullRepayment.amount : 0);
}

// Used when both modes run to a planned exit: compare what actually matters
// by that date — interest, total cash out, and the minimum obligation held.
function renderExitComparison(activeMode, reducePayment, reduceTerm) {
    const active = activeMode === 'reducePayment' ? reducePayment : reduceTerm;
    const other = activeMode === 'reducePayment' ? reduceTerm : reducePayment;
    const activeName = activeMode === 'reducePayment' ? 'reducing the payment' : 'reducing the term';
    const otherName = activeMode === 'reducePayment' ? 'reducing the term' : 'reducing the payment';

    const exitYear = active.fullRepayment.month / 12;
    const interestDiff = active.totalInterest - other.totalInterest;
    const outlayDiff = totalOutlay(active) - totalOutlay(other);
    const minActive = active.schedule[active.months - 1].contractual;
    const minOther = other.schedule[other.months - 1].contractual;

    const interestPhrase = Math.abs(interestDiff) < 1
        ? 'costs virtually the same interest as'
        : `costs ${gbpWhole(Math.abs(interestDiff))} ${interestDiff >= 0 ? 'more' : 'less'} interest than`;
    const outlayPhrase = Math.abs(outlayDiff) < 1
        ? 'an identical total outlay'
        : `a total outlay ${gbpWhole(Math.abs(outlayDiff))} ${outlayDiff >= 0 ? 'higher' : 'lower'}`;
    const minimumPhrase = minActive <= minOther
        ? 'the lower floor you keep if income or rates change before the exit'
        : 'note the other mode would hold the lower minimum here';

    modeComparisonEl.textContent = `Up to the planned exit at the end of year ${exitYear}, ${activeName} ${interestPhrase} ${otherName}, with ${outlayPhrase} (final repayment ${gbpWhole(active.fullRepayment.amount)} vs ${gbpWhole(other.fullRepayment.amount)}). The contractual minimum just before exit is ${gbpWhole(minActive)}/month against ${gbpWhole(minOther)} — ${minimumPhrase}.`;
}

function updateModeComparison(activeMode, reducePayment, reduceTerm) {
    if (reducePayment.fullRepayment && reduceTerm.fullRepayment) {
        renderExitComparison(activeMode, reducePayment, reduceTerm);
        modeComparisonEl.classList.remove('hidden');
        return;
    }
    const extraInterest = reducePayment.totalInterest - reduceTerm.totalInterest;
    const gap = gbpWhole(Math.abs(extraInterest));
    const similarCost = Math.abs(extraInterest) < 1;
    const lowMinimum = gbpWhole(finalPeriodContractual(reducePayment));
    const highMinimum = gbpWhole(finalPeriodContractual(reduceTerm));

    if (activeMode === 'reducePayment') {
        const cost = similarCost
            ? 'costs about the same in interest as'
            : `costs ${gap} ${extraInterest >= 0 ? 'more' : 'less'} in interest than`;
        modeComparisonEl.textContent = `Reducing the payment ${cost} reducing the term (which would pay off in ${formatPayoff(reduceTerm.months)}), but the contractual minimum falls to ${lowMinimum}/month by the final fixed period instead of staying around ${highMinimum} — the same overpayment freedom, with a far smaller obligation if income or rates change.`;
    } else {
        const saving = similarCost
            ? 'about the same total interest'
            : extraInterest >= 0 ? `${gap} less interest` : `${gap} more interest`;
        modeComparisonEl.textContent = `Reducing the term pays off in ${formatPayoff(reduceTerm.months)} with ${saving} than reducing the payment, but the contractual minimum stays around ${highMinimum}/month for the life of the loan; reducing the payment would let it fall to ${lowMinimum}/month with the same overpayment freedom.`;
    }
    modeComparisonEl.classList.remove('hidden');
}

// Fair comparison: consolidating adds the debt to the principal AND frees the
// standalone loan's monthly payment, which goes into the mortgage payment.
function updateConsolidationPanel(inputs, overpaymentMode, baseline) {
    const amount = parseFloat(consolidationAmountInput.value);
    if (isNaN(amount) || amount <= 0) {
        consolidationPanelEl.classList.add('hidden');
        return;
    }
    const apr = parseFloat(consolidationRateInput.value);
    const loanTermYears = parseInt(consolidationTermInput.value);
    if (isNaN(apr) || apr < 0 || isNaN(loanTermYears) || loanTermYears < 1) {
        consolidationPanelEl.textContent = "Enter a valid standalone APR and term to compare consolidation.";
        consolidationPanelEl.classList.remove('hidden');
        return;
    }

    const standalone = standaloneLoanCost(amount, apr / 100, loanTermYears);
    // Matched cash flows: the standalone loan's payment goes into the
    // mortgage instead, but only for the months the loan would have run.
    const consolidated = simulate({
        ...inputs,
        overpaymentMode,
        principal: inputs.principal + amount,
        extraPayment: { monthlyAmount: standalone.monthlyPayment, months: loanTermYears * 12 },
    });
    const extraInterest = consolidated.totalInterest - baseline.totalInterest;
    const saving = standalone.totalInterest - extraInterest;

    const mortgageCost = extraInterest >= 0
        ? `adds ${gbpWhole(extraInterest)} of mortgage interest`
        : `even reduces total mortgage interest by ${gbpWhole(-extraInterest)}`;
    const verdict = saving >= 0
        ? `consolidation saves ${gbpWhole(saving)}`
        : `the standalone loan is ${gbpWhole(-saving)} cheaper here`;
    const payoffNote = consolidated.months !== baseline.months
        ? ` Mortgage payoff becomes ${formatPayoff(consolidated.months)}.`
        : '';
    consolidationPanelEl.textContent = `Consolidating ${gbpWhole(amount)} under the mortgage — paying the same ${gbp(standalone.monthlyPayment)}/month into it for those ${loanTermYears} ${loanTermYears === 1 ? 'year' : 'years'} — ${mortgageCost}. As a standalone loan at ${apr}% it would cost ${gbpWhole(standalone.totalInterest)} in interest, so ${verdict}.${payoffNote}`;
    consolidationPanelEl.classList.remove('hidden');
}

function updateMortgageBSummary(resultB, resultA) {
    const interestDelta = resultB.totalInterest - resultA.totalInterest;
    const monthsDelta = resultB.months - resultA.months;
    const deltaParts = [];
    if (Math.abs(interestDelta) >= 1) {
        deltaParts.push(`${gbpWhole(Math.abs(interestDelta))} ${interestDelta > 0 ? 'more' : 'less'} interest`);
    }
    if (monthsDelta !== 0) {
        deltaParts.push(`pays off ${formatDuration(Math.abs(monthsDelta))} ${monthsDelta > 0 ? 'later' : 'sooner'}`);
    }

    const rows = [
        ['Payoff time', formatPayoff(resultB.months)],
        ['Total interest', gbp(resultB.totalInterest)],
        ['Product fees', gbp(resultB.totalFees)],
        ['Total overpayments', gbp(resultB.totalOverpayments)],
    ];
    mortgageBSummaryEl.innerHTML = rows.map(([label, value]) =>
        `<div class="flex justify-between gap-2"><span class="text-gray-500">${label}</span><span class="font-semibold text-indigo-600">${value}</span></div>`
    ).join('') + `<div class="pt-2 mt-2 border-t border-gray-200 text-gray-600">${deltaParts.length ? `vs Mortgage A: ${deltaParts.join(', ')}.` : 'Matches Mortgage A.'}</div>`;
    mortgageBSummaryEl.classList.remove('hidden');
}

function updateUI(result, graphs, graphsB) {
    payoffTimeEl.textContent = formatPayoff(result.months);
    totalInterestEl.textContent = gbp(result.totalInterest);
    initialContractualPaymentEl.textContent = gbp(result.initialContractualPayment);
    totalOverpaymentsEl.textContent = gbp(result.totalOverpayments);

    const datasets = payoffChart.data.datasets;
    datasets[0].data = graphs.interest;
    datasets[1].data = graphs.payment;
    datasets[2].data = graphs.principal;
    datasets[3].data = graphs.contractual;
    datasets[4].data = graphsB ? graphsB.interest : [];
    datasets[5].data = graphsB ? graphsB.payment : [];
    datasets[6].data = graphsB ? graphsB.principal : [];
    datasets[7].data = graphsB ? graphsB.contractual : [];
    payoffChart.update();
}

function showError(message) {
    errorMessageEl.textContent = message;
    errorMessageEl.classList.remove('hidden');
}

function showInfo(message) {
    infoMessageEl.textContent = message;
    infoMessageEl.classList.remove('hidden');
}

// --- Chart Initialization ---
function createChart() {
    const ctx = document.getElementById('payoffChart').getContext('2d');
    payoffChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Monthly Interest',
                data: [],
                borderColor: 'rgba(220, 38, 38, 1)', // red-600
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y'
            },
                {
                    label: 'Actual Payment',
                    data: [],
                    borderColor: 'rgba(79, 70, 229, 1)', // indigo-600
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Remaining Principal',
                    data: [],
                    backgroundColor: 'rgba(16, 185, 129, 0.2)', // green-400
                    borderColor: 'rgba(5, 150, 105, 1)', // green-600
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y1'
                },
                {
                    label: 'Contractual Minimum',
                    data: [],
                    borderColor: 'rgba(100, 116, 139, 1)', // slate-500
                    borderDash: [6, 4],
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Monthly Interest (B)',
                    data: [],
                    borderColor: 'rgba(220, 38, 38, 0.9)',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Actual Payment (B)',
                    data: [],
                    borderColor: 'rgba(79, 70, 229, 0.9)',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Remaining Principal (B)',
                    data: [],
                    borderColor: 'rgba(5, 150, 105, 0.9)',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y1'
                },
                {
                    label: 'Contractual Minimum (B)',
                    data: [],
                    borderColor: 'rgba(100, 116, 139, 0.9)',
                    borderDash: [2, 3],
                    borderWidth: 1.5,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { // Left axis for monthly amounts
                    beginAtZero: true,
                    position: 'left',
                    ticks: { callback: value => '£' + value.toLocaleString('en-GB') },
                    title: { display: true, text: 'Monthly Amount' }
                },
                y1: { // Right axis for principal balance
                    beginAtZero: true,
                    position: 'right',
                    grid: {
                        drawOnChartArea: false, // Only show grid lines for the left axis
                    },
                    ticks: { callback: value => '£' + (value/1000).toFixed(0) + 'k' },
                    title: { display: true, text: 'Remaining Principal' }
                },
                x: {
                    type: 'linear',
                    min: 0,
                    title: { display: true, text: 'Years' }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        // Hide legend entries for series with no data (Mortgage B when disabled)
                        filter: (item, data) => data.datasets[item.datasetIndex].data.length > 0
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    filter: item => item.parsed.y !== null,
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            const months = Math.round(items[0].parsed.x * 12);
                            return months === 0 ? 'Start' : formatDuration(months);
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', () => {
    createChart();
    mortgageA = createMortgagePanel(document.getElementById('mortgage-a'), 'a');
    mortgageB = createMortgagePanel(mortgageBFormEl, 'b');

    compareToggle.addEventListener('change', () => {
        mortgageBFormEl.classList.toggle('hidden', !compareToggle.checked);
        mortgageBHintEl.classList.toggle('hidden', compareToggle.checked);
        runSimulation();
    });
    [consolidationAmountInput, consolidationRateInput, consolidationTermInput].forEach(input => {
        input.addEventListener('input', runSimulation);
    });

    runSimulation();
});
