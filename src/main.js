import Chart from 'chart.js/auto';
import './style.css';
import { simulate, standaloneLoanCost } from './simulation.js';

// --- DOM Elements ---
const principalInput = document.getElementById('principal');
const termInput = document.getElementById('term');
const paymentAmountInput = document.getElementById('paymentAmount');
const fullRepaymentSelect = document.getElementById('fullRepayment');
const consolidationAmountInput = document.getElementById('consolidationAmount');
const consolidationRateInput = document.getElementById('consolidationRate');
const consolidationTermInput = document.getElementById('consolidationTerm');
const consolidationPanelEl = document.getElementById('consolidation-panel');
const interestRatePeriodsDiv = document.getElementById('interestRatePeriods');
const addRateBtn = document.getElementById('addRateBtn');

const payoffTimeEl = document.getElementById('payoffTime');
const totalInterestEl = document.getElementById('totalInterest');
const initialContractualPaymentEl = document.getElementById('initialContractualPayment');
const totalOverpaymentsEl = document.getElementById('totalOverpayments');
const errorMessageEl = document.getElementById('error-message');
const infoMessageEl = document.getElementById('info-message');
const modeComparisonEl = document.getElementById('mode-comparison');

let payoffChart = null;

const gbp = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const gbpWhole = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const formatPayoff = months => `${Math.floor(months / 12)} years, ${months % 12} months`;

// Contractual payment in force during the loan's final fixed period
// (constant within a period, so the last schedule row carries it)
function finalPeriodContractual(result) {
    return result.schedule[result.months - 1].contractual;
}

// Reads the per-line schedule: {months, rate (decimal), fee}.
// Returns null if any line is incomplete or invalid.
function readRatePeriods() {
    const rows = Array.from(interestRatePeriodsDiv.children);
    const periods = [];
    for (const row of rows) {
        const months = parseInt(row.querySelector('.months-input').value);
        const rate = parseFloat(row.querySelector('.rate-input').value);
        const feeRaw = row.querySelector('.fee-input').value;
        const fee = feeRaw === '' ? 0 : parseFloat(feeRaw);
        if (isNaN(months) || months < 1 || isNaN(rate) || isNaN(fee) || fee < 0) return null;
        periods.push({ months, rate: rate / 100, fee });
    }
    return periods;
}

let repaymentOptionsKey = null;

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
    const previous = fullRepaymentSelect.value;
    fullRepaymentSelect.innerHTML = '<option value="">No — run to payoff</option>';
    for (const boundary of boundaries) {
        const option = document.createElement('option');
        option.value = String(boundary);
        option.textContent = `After ${formatPayoff(boundary)}`;
        fullRepaymentSelect.appendChild(option);
    }
    if (Array.from(fullRepaymentSelect.options).some(o => o.value === previous)) {
        fullRepaymentSelect.value = previous;
    }
}

// --- Simulation ---

function runSimulation() {
    errorMessageEl.classList.add('hidden');
    infoMessageEl.classList.add('hidden');

    // --- Get Inputs ---
    const principal = parseFloat(principalInput.value);
    const termYears = parseInt(termInput.value);
    const paymentAmount = parseFloat(paymentAmountInput.value) || 0;
    const ratePeriods = readRatePeriods();
    const overpaymentMode = document.querySelector('input[name="overpaymentMode"]:checked').value;

    // --- Validate Inputs ---
    if (isNaN(principal) || principal <= 0) { showError("Invalid principal amount."); return; }
    if (isNaN(termYears) || termYears <= 0) { showError("Invalid term."); return; }
    if (isNaN(paymentAmount) || paymentAmount <= 0) { showError("Invalid payment amount."); return; }
    if (interestRatePeriodsDiv.children.length === 0) { showError("Please add at least one interest rate period."); return; }
    if (ratePeriods === null) { showError("Please fill in every rate period: length in months, rate, and fee (0 for none)."); return; }

    syncFullRepaymentOptions(ratePeriods, termYears * 12);
    const fullRepaymentMonth = fullRepaymentSelect.value === '' ? null : parseInt(fullRepaymentSelect.value);

    const inputs = { principal, termYears, paymentAmount, ratePeriods, fullRepaymentMonth };
    const reducePayment = simulate({ ...inputs, overpaymentMode: 'reducePayment' });
    const reduceTerm = simulate({ ...inputs, overpaymentMode: 'reduceTerm' });
    const result = overpaymentMode === 'reducePayment' ? reducePayment : reduceTerm;

    updateModeComparison(overpaymentMode, reducePayment, reduceTerm);
    updateConsolidationPanel(inputs, overpaymentMode, result);

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

    // A null anchor at x=0 keeps every dataset index-aligned with the
    // principal series (which starts at the full principal), so the
    // tooltip's index mode shows the same month across all lines.
    const interestGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.interest }))];
    const paymentGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.payment }))];
    const contractualGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.contractual }))];
    const principalGraphData = [
        { x: 0, y: principal },
        ...result.schedule.map(row => ({ x: row.month / 12, y: Math.max(0, row.balance) })),
    ];
    if (result.fullRepayment) {
        principalGraphData.push({ x: result.fullRepayment.month / 12, y: 0 });
    }

    updateUI(result, interestGraphData, paymentGraphData, principalGraphData, contractualGraphData);
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

function updateUI(result, interestData, paymentData, principalData, contractualData) {
    payoffTimeEl.textContent = formatPayoff(result.months);
    totalInterestEl.textContent = gbp(result.totalInterest);
    initialContractualPaymentEl.textContent = gbp(result.initialContractualPayment);
    totalOverpaymentsEl.textContent = gbp(result.totalOverpayments);

    payoffChart.data.datasets[0].data = interestData;
    payoffChart.data.datasets[1].data = paymentData;
    payoffChart.data.datasets[2].data = principalData;
    payoffChart.data.datasets[3].data = contractualData;
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

// --- Dynamic Rate Period Management ---

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
    interestRatePeriodsDiv.appendChild(periodDiv);
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

// Show each row's cumulative month range, derived from the durations above it
function relabelRatePeriods() {
    let start = 0;
    Array.from(interestRatePeriodsDiv.children).forEach((row, index) => {
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
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    filter: item => item.parsed.y !== null,
                    callbacks: {
                        title: function(items) {
                            if (!items.length) return '';
                            const months = Math.round(items[0].parsed.x * 12);
                            if (months === 0) return 'Start';
                            const years = Math.floor(months / 12);
                            const rest = months % 12;
                            const parts = [];
                            if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
                            if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
                            return parts.join(', ');
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

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    createChart();
    // Add initial rate periods with new defaults
    addRatePeriod(24, 4.64, 0);
    addRatePeriod(24, 4.29, 0);
    addRatePeriod(24, 3.94, 0);
    runSimulation();
});

addRateBtn.addEventListener('click', () => {
    const lastRow = interestRatePeriodsDiv.lastElementChild;
    const lastMonths = lastRow ? parseInt(lastRow.querySelector('.months-input').value) : NaN;
    addRatePeriod(isNaN(lastMonths) || lastMonths < 1 ? 24 : lastMonths);
});
[principalInput, termInput, paymentAmountInput].forEach(input => {
    input.addEventListener('input', runSimulation);
});
document.querySelectorAll('input[name="overpaymentMode"]').forEach(radio => {
    radio.addEventListener('change', runSimulation);
});
fullRepaymentSelect.addEventListener('change', runSimulation);
[consolidationAmountInput, consolidationRateInput, consolidationTermInput].forEach(input => {
    input.addEventListener('input', runSimulation);
});
