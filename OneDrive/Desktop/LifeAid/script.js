'use strict';
// 'use strict' enables strict mode — catches common mistakes like using undeclared variables
// and prevents certain unsafe actions (e.g., writing to read-only properties).

/* ══════════════════════════════════════════
   CONSTANTS & CONFIG
   These values never change while the app is running.
══════════════════════════════════════════ */

const API_URL   = 'https://api.anthropic.com/v1/messages'; // The Anthropic API endpoint Claude responds from
const AI_MODEL  = 'claude-sonnet-4-20250514';              // Which version of Claude to use
const MAX_TOKENS = 700;                                     // Max length of Claude's response (in tokens ≈ words)

// A pool of health quotes shown randomly on the Home screen
const QUOTES = [
  { text: 'The greatest wealth is health.', author: 'Virgil' },
  { text: 'Take care of your body. It\'s the only place you have to live.', author: 'Jim Rohn' },
  { text: 'Health is not valued till sickness comes.', author: 'Thomas Fuller' },
  { text: 'To keep the body in good health is a duty.', author: 'Buddha' },
  { text: 'A healthy outside starts from the inside.', author: 'Robert Urich' },
  { text: 'Your body hears everything your mind says. Stay positive.', author: 'Naomi Judd' },
  { text: 'It is health that is real wealth.', author: 'Mahatma Gandhi' },
];

// Maps each mood label to a numeric score (used in wellness score calculation)
const MOOD_SCORE  = { Amazing: 100, Great: 85, Good: 70, Okay: 50, Bad: 30, Terrible: 15 };

// Maps mood labels to their display emojis
const MOOD_EMOJI  = { Amazing: '🤩', Great: '😄', Good: '🙂', Okay: '😐', Bad: '😞', Terrible: '😣' };

// Maps mood labels to chart bar colors
const MOOD_COLORS = { Amazing: '#1D9E75', Great: '#1D9E75', Good: '#3B82F6', Okay: '#F59E0B', Bad: '#F97316', Terrible: '#EF4444' };

// A function that returns a color based on score value
// s >= 75 → green, s >= 55 → blue, s >= 40 → amber, else red
const SCORE_COLOR = s => s >= 75 ? '#1D9E75' : s >= 55 ? '#3B82F6' : s >= 40 ? '#F59E0B' : '#EF4444';

// Default reminders shown on the Reminders page
// Each has an icon, name, time description, and on/off toggle state
const REMINDERS = [
  { icon: '💧', name: 'Drink Water',      time: 'Every 2 hours',    on: true  },
  { icon: '🏃', name: 'Move & Stretch',   time: '10:00 AM · 3 PM',  on: true  },
  { icon: '😴', name: 'Wind Down',        time: '9:30 PM',          on: true  },
  { icon: '💊', name: 'Vitamins',         time: '8:00 AM',          on: false },
  { icon: '🧘', name: 'Mindfulness',      time: '7:00 AM',          on: true  },
  { icon: '🍎', name: 'Healthy Snack',    time: '4:00 PM',          on: false },
  { icon: '🚶', name: 'Evening Walk',     time: '6:30 PM',          on: true  },
  { icon: '📱', name: 'Screen Break',     time: 'Every 90 min',     on: true  },
];

/* ══════════════════════════════════════════
   STATE
   These variables hold data that changes while the app runs.
   They are loaded from localStorage so data persists across page refreshes.
══════════════════════════════════════════ */

// Load saved user profile from localStorage; if nothing saved, default to null
let profile     = JSON.parse(localStorage.getItem('la_profile')  || 'null');

// Load check-in history array; default to empty array if none saved
let history     = JSON.parse(localStorage.getItem('la_history')  || '[]');

// Load to-do tasks array; default to empty array
let todos       = JSON.parse(localStorage.getItem('la_todos')    || '[]');

// Load today's water glass count; parseInt converts string → number, base 10
let waterCount  = parseInt(localStorage.getItem('la_water')      || '0', 10);

// Chat message history — kept in memory only (not saved to localStorage)
let chatHistory = [];

// Holds the current state of the daily check-in form fields
// These are reset each time the user starts a new check-in
const ci = {
  mood: null,    // Selected mood string e.g. 'Good'
  energy: 5,     // Energy slider value (1–10)
  stress: 4,     // Stress slider value (1–10)
  sleep: 7,      // Sleep hours slider value
  symptoms: [],  // Array of selected symptom tags
  meals: [],     // Array of selected meal tags
  activity: [],  // Array of selected activity tags
  note: ''       // Free-text note from the user
};

// State variables for the animated breathing exercise circle
let breathActive   = false;      // Is the breathing animation currently running?
let breathPhase    = 0;          // Which phase index we're on (0=Inhale, 1=Hold, 2=Exhale)
let breathTimerId  = null;       // Stores the setTimeout ID so we can cancel it if needed

/* ══════════════════════════════════════════
   UTILITIES
   Small helper functions used throughout the app.
══════════════════════════════════════════ */

// Shorthand for document.getElementById() — saves typing
const $ = id => document.getElementById(id);

// Safely sets the text content of an element by ID
// Checks the element exists before writing to avoid errors
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

// Saves todos, history, and waterCount to localStorage so data survives page refresh
const save = () => {
  localStorage.setItem('la_history', JSON.stringify(history)); // Convert array → JSON string → save
  localStorage.setItem('la_todos',   JSON.stringify(todos));
  localStorage.setItem('la_water',   waterCount);
};

// Shows a brief popup notification at the bottom of the screen
// duration controls how long it stays visible (milliseconds)
function showToast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');                            // CSS class triggers the visible animation
  setTimeout(() => t.classList.remove('show'), duration); // Hide it after the duration
}

// Ensures a number stays within a given range [min, max]
// e.g. clamp(110, 0, 100) → 100
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Formats a date ISO string into a readable format like "5 Apr 2025"
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Returns a greeting like "Good morning, Ravi!" based on current hour
function greeting(name = '') {
  const h = new Date().getHours(); // 0–23
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${g}, ${name}!` : `${g}!`; // Include name only if provided
}

// Counts how many consecutive days the user has done a check-in (ending today)
function calcStreak() {
  if (!history.length) return 0; // No history = no streak
  let streak = 0;
  const now = new Date(); now.setHours(0, 0, 0, 0); // Midnight of today

  // Loop backwards from today for up to 60 days
  for (let i = 0; i < 60; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i); // d = today minus i days
    if (history.find(h => new Date(h.date).toDateString() === d.toDateString())) {
      // Found a check-in on this day — continue the streak
      streak++;
    } else if (i > 0) break; // Gap found after at least 1 day → streak ends
  }
  return streak;
}

// Calculates a wellness score (0–100) from check-in data
// Each dimension is normalized to 0–100 and blended with a weighted average
function calcScore(data) {
  const m  = MOOD_SCORE[data.mood] || 50;                    // Mood: already 0–100
  const e  = (data.energy / 10) * 100;                       // Energy: scale from 0–10 → 0–100
  const s  = ((10 - data.stress) / 10) * 100;               // Stress: inverted (low stress = high score)
  const sl = Math.min(data.sleep / 8, 1) * 100;             // Sleep: 8h = 100%; anything more is capped at 100
  const sy = (data.symptoms.length === 0 || data.symptoms.includes('None'))
    ? 100 : Math.max(0, 100 - data.symptoms.length * 15);   // Each symptom subtracts 15 points; min 0
  // Weighted blend: mood 25%, energy 20%, stress 20%, sleep 20%, symptoms 15%
  return Math.round(clamp(m * 0.25 + e * 0.20 + s * 0.20 + sl * 0.20 + sy * 0.15, 5, 100));
}

// Builds the system prompt sent to Claude with user profile and today's data
// forChat = true → used for the chat tab; false → used for the analysis prompt
function buildContext(forChat = false) {
  const p = profile || {};

  // Build a text summary of the user's profile (only if a profile exists)
  const profileCtx = p.name
    ? `User profile: ${p.name}, age ${p.age || 'unknown'}, ${p.gender || ''}. ` +
      `Sleep target: ${p.sleep || '7–8 hours'}. Wake: ${p.wakeTime || '07:00'}. ` +
      `Activity: ${p.activity || 'unknown'}. Diet: ${p.diet || 'unknown'}. ` +
      `Goals: ${p.goals || 'general wellness'}. Conditions: ${p.conditions || 'none'}. ` +
      `Medication: ${p.medication || 'none'}.`
    : '';

  // Find today's check-in entry in history (if any)
  const today = history.find(h => new Date(h.date).toDateString() === new Date().toDateString());
  const todayCtx = today
    ? `Today's check-in: Mood=${today.mood}, Energy=${today.energy}/10, ` +
      `Stress=${today.stress}/10, Sleep=${today.sleep}h, ` +
      `Symptoms=${today.symptoms.join(', ') || 'none'}, ` +
      `Activity=${today.activity.join(', ') || 'not logged'}, ` +
      `Meals=${today.meals.join(', ') || 'not logged'}. ` +
      `Wellness score: ${today.score}.`
    : 'No check-in today yet.';

  // For the chat, prepend a system persona and behavior rules
  if (forChat) {
    return `You are LifeAid, a warm, knowledgeable, and compassionate AI health companion. ` +
      `${profileCtx} ${todayCtx} ` +
      `Give warm, specific, practical wellness advice (NOT medical diagnosis). ` +
      `Keep responses concise (under 130 words). ` +
      `For serious or persistent symptoms, always recommend consulting a qualified healthcare professional.`;
  }
  return profileCtx; // For the analysis call, just return the profile context
}


/* ══════════════════════════════════════════
   ONBOARDING
   Multi-step form shown to new users before they see the app.
══════════════════════════════════════════ */

let obCurrentStep = 1;  // Which onboarding step the user is currently on
const OB_TOTAL = 5;     // Total number of onboarding steps

// Toggle chip selection on/off when clicked (e.g. diet restrictions, health goals)
document.querySelectorAll('.ob-chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('sel')); // 'sel' = selected CSS class
});

// Move the user to the next onboarding step and update the progress bar
function obNext(step) {
  $('ob' + step).classList.remove('active');     // Hide current step
  obCurrentStep = step + 1;
  $('ob' + obCurrentStep).classList.add('active'); // Show next step
  const pct = (obCurrentStep / OB_TOTAL) * 100;   // Calculate progress %
  $('obProgressBar').style.width = pct + '%';      // Update the visual progress bar width
  $('obStepCounter').textContent = `Step ${obCurrentStep} of ${OB_TOTAL}`;
}

// Called when the user finishes the final onboarding step
function finishOnboarding() {
  const name = ($('ob-name').value || '').trim() || 'Friend'; // Default name if left blank

  // Helper: collects text of all selected chips inside a given container
  const getSelChips = id =>
    [...document.querySelectorAll(`#${id} .ob-chip.sel`)].map(c => c.textContent);

  // Build the profile object from all form inputs
  profile = {
    name,
    age:        $('ob-age').value || '',
    gender:     $('ob-gender').value || '',
    sleep:      $('ob-sleep').value || '7–8 hours',
    wakeTime:   $('ob-wake').value || '07:00',
    activity:   $('ob-activity').value || 'Lightly active',
    diet:       getSelChips('ob-diet-chips').join(', ') || 'No restrictions',
    goals:      getSelChips('ob-goal-chips').join(', ') || 'General wellness',
    conditions: getSelChips('ob-cond-chips').join(', ') || 'None',
    medication: ($('ob-med').value || '').trim() || '',
    joinDate:   new Date().toISOString(), // Record when this user joined
  };

  localStorage.setItem('la_profile', JSON.stringify(profile)); // Persist to localStorage
  $('onboarding').style.display = 'none'; // Hide the onboarding screen
  $('app').style.display = 'flex';        // Show the main app
  initApp();
  showToast(`Welcome to LifeAid, ${name}! 🌿`);
}


/* ══════════════════════════════════════════
   APP INITIALISATION
   Runs once when the app loads (or after onboarding completes).
   Populates every section of the UI from stored data.
══════════════════════════════════════════ */
function initApp() {
  if (!profile) return; // Safety guard: don't run if no profile exists

  const av = profile.name.charAt(0).toUpperCase(); // First letter of name for the avatar circle

  // --- Topbar ---
  setText('topAvatar', av);
  setText('topName', profile.name);

  // --- Streak pill in topbar ---
  const streak = calcStreak();
  setText('streakPill', `🔥 ${streak} day${streak !== 1 ? 's' : ''}`); // Pluralise correctly

  // --- Profile page ---
  setText('profAvatar', av);
  setText('profName', profile.name);
  setText('profSince', `Member since ${new Date(profile.joinDate || Date.now()).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`);
  setText('ps-checkins', history.length);           // Total number of check-ins
  setText('ps-streak', streak);

  // Calculate and display average wellness score across all check-ins
  const scores = history.filter(h => h.score).map(h => h.score);
  setText('ps-avg', scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '--');

  // Profile detail fields
  setText('pf-sleep', profile.sleep || '--');
  setText('pf-activity', profile.activity || '--');
  setText('pf-diet', profile.diet || '--');
  setText('pf-goals', profile.goals || '--');
  setText('pf-cond', profile.conditions || 'None');
  setText('pf-med', profile.medication || 'None');

  // --- Initialise all UI sections ---
  setGreeting();
  buildWaterTracker();
  buildWeekChart();
  buildReminders();
  buildTodos();
  buildHistory();
  buildMoodChart();
  setRandomQuote();
  bindCheckinEvents(); // Attach event listeners to check-in form elements
  bindChatEvents();    // Attach event listeners to chat input/send button
  bindNavEvents();     // Attach event listeners to bottom navigation tabs
}

// Shows either a greeting (if no check-in today) or today's wellness score
function setGreeting() {
  const today = history.find(h => new Date(h.date).toDateString() === new Date().toDateString());
  if (today) {
    // Already checked in — show today's score
    setText('scoreGreeting', 'Today\'s score');
    updateScoreRing(today.score);
    updateStatCards(today);
    setText('scoreLabel', scoreLabel(today.score));
    buildScoreBadges(today);
    waterCount = today.water ?? waterCount; // Restore today's water count from saved entry
  } else {
    // No check-in yet — show a friendly greeting and prompt
    setText('scoreGreeting', greeting(profile.name));
    setText('scoreLabel', 'Complete your check-in to get your score');
  }
}

// Returns a human-readable label based on score value
function scoreLabel(s) {
  return s >= 80 ? 'Excellent day 🌟' : s >= 65 ? 'Good day 👍' : s >= 50 ? 'Fair day 🙂' : s >= 35 ? 'Low energy ⚠️' : 'Rest & recover 💤';
}


/* ══════════════════════════════════════════
   SCORE RING
   Animates the circular SVG progress ring on the Home screen.
══════════════════════════════════════════ */
function updateScoreRing(score) {
  const circumference = 2 * Math.PI * 40; // Full circle circumference: 2πr where r=40 (from SVG)
  // strokeDashoffset controls how much of the circle is "filled":
  // 0 = fully filled, circumference = empty
  const offset = circumference - (circumference * (score / 100));
  const ring = $('ringProgress');
  ring.style.strokeDasharray  = circumference; // Total dash pattern length = full circle
  ring.style.strokeDashoffset = offset;        // Gap at the start = unfilled portion
  ring.style.stroke = SCORE_COLOR(score);      // Color the ring based on score
  setText('scoreNum', score);                  // Show the number in the centre
}


/* ══════════════════════════════════════════
   STAT CARDS
   The four small cards below the score ring: Mood, Energy, Stress, Sleep.
══════════════════════════════════════════ */
function updateStatCards(entry) {
  setText('st-mood',   MOOD_EMOJI[entry.mood] || '--');
  setText('st-energy', entry.energy + '/10');
  setText('st-stress', entry.stress + '/10');
  setText('st-sleep',  entry.sleep + 'h');

  // Compare to the previous check-in and show a trend arrow
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  if (prev && prev !== entry) {
    const et = $('st-energyT'); // Energy trend element
    et.textContent = entry.energy > prev.energy ? '↑ Better' : entry.energy < prev.energy ? '↓ Lower' : '→ Same';
    et.className = 'stat-trend ' + (entry.energy >= prev.energy ? 'up' : 'down'); // CSS class sets color

    const st = $('st-stressT'); // Stress trend element
    // For stress: lower is better, so "calmer" = up (green), "higher" = down (red)
    st.textContent = entry.stress < prev.stress ? '↓ Calmer' : entry.stress > prev.stress ? '↑ Higher' : '→ Same';
    st.className = 'stat-trend ' + (entry.stress <= prev.stress ? 'up' : 'down');
  }
}

// Creates small badge labels for positive achievements today (e.g. "Well rested")
function buildScoreBadges(entry) {
  const badges = [];
  if (entry.score >= 80)    badges.push('Top form');
  if (entry.sleep >= 7)     badges.push('Well rested');
  if (entry.stress <= 4)    badges.push('Low stress');
  if (waterCount >= 6)      badges.push('Hydrated');
  if (entry.energy >= 7)    badges.push('Energised');
  // Render each badge as a div and inject into the DOM
  $('scoreBadges').innerHTML = badges.map(b => `<div class="score-badge">${b}</div>`).join('');
}


/* ══════════════════════════════════════════
   WATER TRACKER
   8 clickable glass icons. Clicking a glass sets the count.
══════════════════════════════════════════ */
function buildWaterTracker() {
  const wrap = $('waterGlasses');
  wrap.innerHTML = ''; // Clear any previously rendered glasses

  for (let i = 0; i < 8; i++) {
    const g = document.createElement('div');
    g.className = 'water-glass' + (i < waterCount ? ' filled' : ''); // Mark glasses up to current count as filled
    g.innerHTML = '<div class="water-glass-fill"></div>'; // The blue fill animation layer

    g.addEventListener('click', () => {
      // Clicking the same glass as current count toggles it off (e.g. click glass 3 if count=3 → count=2)
      waterCount = waterCount === i + 1 ? i : i + 1;
      localStorage.setItem('la_water', waterCount);
      buildWaterTracker(); // Re-render with updated count
      if (waterCount === 8) showToast('Amazing! You hit your water goal! 💧');
    });

    wrap.appendChild(g);
  }

  setText('waterCount', waterCount);
  $('waterBarFill').style.width = (waterCount / 8 * 100) + '%'; // Update the progress bar underneath
}


/* ══════════════════════════════════════════
   WEEK CHART
   A 7-bar chart showing wellness scores for the past 7 days.
══════════════════════════════════════════ */
function buildWeekChart() {
  const bars   = $('weekChart');
  const labels = $('weekLabels');
  if (!bars || !labels) return; // Abort if elements don't exist in the DOM
  bars.innerHTML = labels.innerHTML = ''; // Clear before rebuilding

  const now = new Date(); now.setHours(0, 0, 0, 0); // Today at midnight (to avoid time issues)

  // Loop from 6 days ago (i=6) to today (i=0)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); // Date for this iteration

    // Find a check-in entry matching this date
    const entry = history.find(h => new Date(h.date).toDateString() === d.toDateString());
    const score = entry ? entry.score : 0;

    // clamp height to at least 8px so zero-score bars are still faintly visible
    const pct   = score ? clamp(score, 8, 100) : 6;
    const color = score ? SCORE_COLOR(score) : '#D1EBE0'; // Gray for empty days

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = (pct * 0.8) + 'px';  // Scale height (multiply by 0.8 to fit within container)
    bar.style.background = color;
    if (score) bar.innerHTML = `<div class="chart-bar-tip">${score}</div>`; // Tooltip showing score
    bars.appendChild(bar);

    // Day label below the bar (e.g. "Mon", "Tue")
    const lbl = document.createElement('span');
    lbl.textContent = d.toLocaleDateString('en', { weekday: 'short' });
    labels.appendChild(lbl);
  }
}


/* ══════════════════════════════════════════
   MOOD CHART (History page)
   Same structure as the week chart but showing mood scores instead.
══════════════════════════════════════════ */
function buildMoodChart() {
  const chart  = $('moodChart');
  const labels = $('moodLabels');
  if (!chart || !labels) return;
  chart.innerHTML = labels.innerHTML = '';

  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d     = new Date(now); d.setDate(d.getDate() - i);
    const entry = history.find(h => new Date(h.date).toDateString() === d.toDateString());
    const ms    = entry ? (MOOD_SCORE[entry.mood] || 50) : 0; // Mood score; 0 if no entry

    const bar = document.createElement('div');
    bar.className = 'mood-bar';
    // Show a tiny 4px stub if no data, otherwise scale height proportionally
    bar.style.height = ms ? (ms * 0.6) + 'px' : '4px';
    bar.style.background = entry ? MOOD_COLORS[entry.mood] || '#D1EBE0' : '#D1EBE0';
    chart.appendChild(bar);

    const lbl = document.createElement('span');
    lbl.textContent = d.toLocaleDateString('en', { weekday: 'short' });
    labels.appendChild(lbl);
  }
}


/* ══════════════════════════════════════════
   RANDOM QUOTE
══════════════════════════════════════════ */
function setRandomQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)]; // Pick a random index
  setText('quoteText',   q.text);
  setText('quoteAuthor', `— ${q.author}`);
}


/* ══════════════════════════════════════════
   REMINDERS
══════════════════════════════════════════ */
function buildReminders() {
  const list = $('remindersList');
  if (!list) return;

  // Build HTML for all reminder items using template literals
  list.innerHTML = REMINDERS.map((r, i) => `
    <div class="reminder-item">
      <div class="rem-icon">${r.icon}</div>
      <div class="rem-info">
        <div class="rem-name">${r.name}</div>
        <div class="rem-time">${r.time}</div>
      </div>
      <!-- data-idx stores the index in REMINDERS array so we know which to toggle -->
      <div class="toggle ${r.on ? 'on' : ''}" data-idx="${i}"></div>
    </div>
  `).join('');

  // Attach click handlers to each toggle switch after rendering
  list.querySelectorAll('.toggle').forEach(tog => {
    tog.addEventListener('click', () => {
      const i = +tog.dataset.idx; // + converts the string attribute to a number
      REMINDERS[i].on = !REMINDERS[i].on; // Flip the on/off state
      tog.classList.toggle('on');          // Update the visual toggle state
      showToast(REMINDERS[i].on ? `${REMINDERS[i].name} reminder ON` : `${REMINDERS[i].name} reminder OFF`);
    });
  });
}


/* ══════════════════════════════════════════
   TODOS
══════════════════════════════════════════ */
function buildTodos() {
  const list = $('todoList');
  if (!list) return;

  // Only show tasks that have not been archived
  const active = todos.filter(t => !t.archived);

  if (!active.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No tasks yet. Add one below or complete a check-in to get AI-suggested tasks.</p></div>';
    return;
  }

  // Render each active task as a clickable row
  list.innerHTML = active.map((t, i) => `
    <div class="todo-item ${t.done ? 'done' : ''}" data-idx="${i}">
      <div class="todo-check">${t.done ? '✓' : ''}</div>
      <div class="todo-text">${t.text}</div>
      <span class="todo-badge ${t.tag || 'general'}">${t.tag || 'general'}</span>
    </div>
  `).join('');

  // Toggle done/not-done state when a task row is clicked
  list.querySelectorAll('.todo-item').forEach(item => {
    item.addEventListener('click', () => {
      const i = +item.dataset.idx;
      todos[i].done = !todos[i].done;
      save();
      buildTodos(); // Re-render to reflect the change
    });
  });
}

// Open the modal dialog for adding a new task
function openTodoModal()  { $('todoModal').style.display = 'flex'; $('newTodoInput').focus(); }

// Close and clear the modal
function closeTodoModal() { $('todoModal').style.display = 'none'; $('newTodoInput').value = ''; }

// Save the new task from the modal input
function saveNewTodo() {
  const text = ($('newTodoInput').value || '').trim();
  if (!text) { showToast('Please enter a task name'); return; }
  todos.push({ text, tag: $('newTodoTag').value, done: false, date: new Date().toISOString() });
  save();
  buildTodos();
  closeTodoModal();
  showToast('Task added! ✅');
}

// Allow pressing Enter inside the modal text input to save the task
document.addEventListener('DOMContentLoaded', () => {
  $('newTodoInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveNewTodo(); });
  // ?. is optional chaining — safely skips if the element doesn't exist
});


/* ══════════════════════════════════════════
   HISTORY LIST
   Shows all past check-ins in reverse chronological order.
══════════════════════════════════════════ */
function buildHistory() {
  const list = $('historyList');
  if (!list) return;

  if (!history.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📈</div><p>No check-ins yet. Complete your first daily check-in to start tracking your wellness journey.</p></div>';
    return;
  }

  // [...history].reverse() creates a reversed copy without mutating the original array
  list.innerHTML = [...history].reverse().map(h => {
    const d     = new Date(h.date);
    const color = SCORE_COLOR(h.score || 50);
    return `
      <div class="hist-item">
        <div class="hist-date">
          <div class="hist-day">${d.getDate()}</div>
          <div class="hist-mon">${d.toLocaleDateString('en', { month: 'short' })}</div>
        </div>
        <div class="hist-body">
          <div class="hist-mood">${MOOD_EMOJI[h.mood] || '😐'} ${h.mood || 'Check-in'}</div>
          <div class="hist-detail">Energy ${h.energy}/10 · Stress ${h.stress}/10 · Sleep ${h.sleep}h</div>
        </div>
        <div class="hist-score" style="color:${color}">${h.score || '--'}</div>
      </div>
    `;
  }).join('');
}


/* ══════════════════════════════════════════
   CHECK-IN
   Wires up all interactive elements in the daily check-in form.
══════════════════════════════════════════ */
function bindCheckinEvents() {
  // Mood emoji buttons — only one can be selected at a time
  document.querySelectorAll('#moodRow .em-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#moodRow .em-opt').forEach(o => o.classList.remove('sel')); // Deselect all
      opt.classList.add('sel');       // Select clicked one
      ci.mood = opt.dataset.mood;    // Store mood value from data attribute
    });
  });

  // Energy slider: update the live number display as the slider moves
  $('ciEnergy')?.addEventListener('input', function() {
    ci.energy = +this.value;           // this.value is a string; + converts to number
    setText('ciEV', this.value);       // Update the displayed number next to the slider
  });

  // Stress slider
  $('ciStress')?.addEventListener('input', function() {
    ci.stress = +this.value;
    setText('ciSV', this.value);
  });

  // Sleep slider — appends 'h' (hours) to the displayed value
  $('ciSleep')?.addEventListener('input', function() {
    ci.sleep = +this.value;
    setText('ciSLV', this.value + 'h');
  });

  // Symptom chips: supports multi-select, but "None" clears all others
  document.querySelectorAll('#ciSymptoms .ci-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const sym = tag.dataset.sym;
      const isNone = sym === 'None';
      if (isNone) {
        // "None" deselects everything else and selects itself
        document.querySelectorAll('#ciSymptoms .ci-tag').forEach(t => t.classList.remove('sel'));
        tag.classList.add('sel');
        ci.symptoms = ['None'];
      } else {
        // Deselect "None" when another symptom is chosen
        document.querySelector('#ciSymptoms [data-sym="None"]')?.classList.remove('sel');
        tag.classList.toggle('sel'); // Toggle this tag on/off
        // Rebuild ci.symptoms from all currently selected tags (excluding "None")
        ci.symptoms = [...document.querySelectorAll('#ciSymptoms .ci-tag.sel:not([data-sym="None"])')].map(t => t.dataset.sym);
      }
    });
  });

  // Meal chips: multi-select
  document.querySelectorAll('.meal-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('sel');
      const meal = tag.dataset.meal;
      // Toggle meal in/out of the ci.meals array
      ci.meals = ci.meals.includes(meal) ? ci.meals.filter(m => m !== meal) : [...ci.meals, meal];
    });
  });

  // Activity chips: single-select (like radio buttons)
  document.querySelectorAll('.act-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      document.querySelectorAll('.act-tag').forEach(t => t.classList.remove('sel')); // Deselect all
      tag.classList.add('sel');
      ci.activity = [tag.dataset.act]; // Store as array for consistency with meals/symptoms
    });
  });

  $('analyseBtn')?.addEventListener('click', runAnalysis); // "Analyse" button → call AI

  // "Add all to todos" button — appears after analysis generates tasks
  $('addAllBtn')?.addEventListener('click', () => {
    // Collect all AI-suggested task texts from the rendered list
    const tasks = [...document.querySelectorAll('#ciTodoList .action-todo')].map(el => ({
      text: el.querySelector('.todo-text').textContent,
      tag: 'health', done: false, date: new Date().toISOString()
    }));
    // Only add tasks not already in the todos list (avoid duplicates)
    tasks.forEach(t => { if (!todos.find(existing => existing.text === t.text)) todos.push(t); });
    save();
    buildTodos();
    showToast('Tasks added to your list! ✅');
  });
}

// Called when the user clicks "Analyse" — sends check-in data to Claude and shows results
async function runAnalysis() {
  if (!ci.mood) { showToast('Please select your mood first'); return; } // Mood is required

  // Read current slider values directly from DOM (in case user moved sliders without triggering input events)
  ci.energy = +($('ciEnergy').value);
  ci.stress = +($('ciStress').value);
  ci.sleep  = +($('ciSleep').value);
  ci.note   = ($('ciNote').value || '').trim();

  // Show the insight section and display a loading state
  $('insightSection').style.display = 'block';
  $('analyseBtn').disabled = true;                 // Prevent double-clicking
  $('addAllBtn').style.display = 'none';           // Hide until tasks are loaded
  $('insightText').innerHTML   = '<span class="loading-dot">Analysing your health data</span>';
  $('ciTodoList').innerHTML    = '';
  $('scoreBreakdown').innerHTML = '';

  // Scroll the insight section into view smoothly
  $('insightSection').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Build the prompt with the user's check-in data and profile context
  const profileCtx = buildContext();
  const prompt = `You are LifeAid, a warm and knowledgeable AI health companion.

${profileCtx}

Today's check-in data:
- Mood: ${ci.mood}
- Energy: ${ci.energy}/10
- Stress: ${ci.stress}/10
- Sleep last night: ${ci.sleep} hours
- Symptoms: ${ci.symptoms.join(', ') || 'None'}
- Meals eaten: ${ci.meals.join(', ') || 'Not logged'}
- Physical activity: ${ci.activity.join(', ') || 'Not logged'}
- Personal note: "${ci.note || 'none'}"

Respond in this EXACT format (no extra text):
INSIGHT: [2-3 warm, personalised sentences analysing the data and what it means for them today. Reference their specific numbers. Be compassionate and specific.]

TASK: [specific actionable task 1 tailored to their data]
TASK: [specific actionable task 2 tailored to their data]
TASK: [specific actionable task 3 tailored to their data]

Keep all advice wellness-focused, not medical. Avoid diagnosing.`;

  try {
    // Send the prompt to Claude via the Anthropic API
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) throw new Error(`API error ${res.status}`); // Throw if HTTP status is not 2xx

    const data = await res.json();
    // Join all text blocks from Claude's response (there may be multiple content blocks)
    const text = data.content.map(b => b.text || '').join('');

    // Parse the structured INSIGHT and TASK sections from Claude's response
    const insightMatch = text.match(/INSIGHT:\s*([\s\S]*?)(?=\nTASK:|$)/); // Regex: grab text after "INSIGHT:" up to the first "TASK:" or end
    const tasks        = [...text.matchAll(/TASK:\s*(.+)/g)].map(m => m[1].trim()); // Find all "TASK: ..." lines
    const insight      = insightMatch ? insightMatch[1].trim() : text.split('\n')[0]; // Fallback: use first line

    $('insightText').textContent = insight; // Display the AI's insight paragraph

    // Calculate and display the wellness score
    const score = calcScore(ci);
    updateScoreRing(score);
    setText('scoreGreeting', 'Today\'s score');
    setText('scoreLabel', scoreLabel(score));
    buildScoreBreakdown(ci);                     // Show per-dimension breakdown bars
    updateStatCards({ ...ci, score });           // Spread ci + add score for stat cards
    buildScoreBadges({ ...ci, score });

    // Render the suggested tasks as clickable to-do items
    if (tasks.length) {
      $('ciTodoList').innerHTML = tasks.map(t => `
        <div class="action-todo">
          <div class="todo-check"></div>
          <div class="todo-text">${t}</div>
        </div>
      `).join('');

      // Make each task tappable to mark as done
      $('ciTodoList').querySelectorAll('.action-todo').forEach(el => {
        el.addEventListener('click', () => {
          el.classList.toggle('done');
          el.querySelector('.todo-check').textContent = el.classList.contains('done') ? '✓' : '';
        });
      });
      $('addAllBtn').style.display = 'block'; // Show the "Add all" button
    }

    // Build the check-in entry object and save it to history
    const entry = {
      date: new Date().toISOString(),
      mood: ci.mood, energy: ci.energy, stress: ci.stress,
      sleep: ci.sleep, symptoms: ci.symptoms, activity: ci.activity,
      meals: ci.meals, note: ci.note, score, insight, water: waterCount
    };

    // Update today's entry if it already exists, otherwise push a new one
    const todayIdx = history.findIndex(h => new Date(h.date).toDateString() === new Date().toDateString());
    if (todayIdx >= 0) history[todayIdx] = entry; else history.push(entry);
    save();

    // Refresh all UI sections that depend on history
    buildWeekChart();
    buildHistory();
    buildMoodChart();
    const streak = calcStreak();
    setText('streakPill', `🔥 ${streak} day${streak !== 1 ? 's' : ''}`);
    setText('ps-checkins', history.length);
    setText('ps-streak', streak);
    const scores = history.filter(h => h.score).map(h => h.score);
    setText('ps-avg', scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '--');

    showToast(`Check-in complete! Score: ${score} 🎉`);
  } catch (err) {
    // Handle network or API errors gracefully
    console.error('AI error:', err);
    $('insightText').textContent = 'Could not connect to AI. Please check your connection and try again.';
    showToast('Connection error. Please try again.');
  }

  $('analyseBtn').disabled = false; // Re-enable the button whether success or failure
}

// Renders horizontal bar rows showing score breakdown by dimension
function buildScoreBreakdown(data) {
  const items = [
    { label: 'Mood',     val: MOOD_SCORE[data.mood] || 50 },
    { label: 'Energy',   val: (data.energy / 10) * 100 },
    { label: 'Calm',     val: ((10 - data.stress) / 10) * 100 }, // Inverted: calm = 10 - stress
    { label: 'Sleep',    val: Math.min(data.sleep / 8, 1) * 100 },
    { label: 'Symptoms', val: (data.symptoms.length === 0 || data.symptoms.includes('None')) ? 100 : Math.max(0, 100 - data.symptoms.length * 15) },
  ];
  $('scoreBreakdown').innerHTML = items.map(item => `
    <div class="sb-row">
      <span class="sb-label">${item.label}</span>
      <div class="sb-bar-wrap">
        <div class="sb-bar-fill" style="width:${Math.round(item.val)}%"></div>
      </div>
      <span class="sb-val">${Math.round(item.val)}</span>
    </div>
  `).join('');
}


/* ══════════════════════════════════════════
   CHAT
   The AI chat assistant tab.
══════════════════════════════════════════ */
function bindChatEvents() {
  $('sendBtn')?.addEventListener('click', sendMessage);

  // Send on Enter key press (but allow Shift+Enter for new lines)
  $('chatInput')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); });

  // Quick-question chips: clicking one pre-fills and sends the message automatically
  document.querySelectorAll('.q-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('chatInput').value = chip.dataset.q; // Pre-fill the input
      sendMessage();                          // Send immediately
    });
  });
}

// Sends a user message to Claude and displays the reply
async function sendMessage() {
  const input = $('chatInput');
  const msg   = (input.value || '').trim();
  if (!msg) return; // Ignore empty input
  input.value = '';  // Clear the input field

  appendMessage(msg, 'user');                           // Show user's message in chat
  chatHistory.push({ role: 'user', content: msg });    // Add to conversation history for multi-turn context

  const aiId = 'ai_' + Date.now(); // Unique ID for the AI response bubble (used to update it in-place)
  appendMessage('<span class="loading-dot">Thinking</span>', 'ai', aiId); // Placeholder while waiting

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      AI_MODEL,
        max_tokens: 450,
        system:     buildContext(true),        // System prompt with profile + today's data
        messages:   chatHistory.slice(-12)     // Send last 12 messages to keep context within limits
      })
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data  = await res.json();
    const reply = data.content.map(b => b.text || '').join(''); // Extract text from response
    updateAiMessage(aiId, reply);                               // Replace "Thinking..." with actual reply
    chatHistory.push({ role: 'assistant', content: reply });    // Add Claude's reply to history
  } catch (err) {
    console.error('Chat error:', err);
    updateAiMessage(aiId, 'Connection error. Please check your network and try again.');
  }
}

// Appends a message bubble to the chat window
function appendMessage(content, type, id = '') {
  const msgs = $('chatMessages');
  const div  = document.createElement('div');
  div.className = type === 'user' ? 'msg user-msg' : 'msg ai-msg';
  if (id) div.id = id; // Set the ID so we can find and update this bubble later
  div.innerHTML = type === 'ai'
    ? `<div class="ai-badge">LifeAid AI</div><div class="msg-body">${content}</div>`
    : `<div class="msg-body">${content}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight; // Auto-scroll to the newest message
}

// Updates an existing AI message bubble by its ID (replaces "Thinking..." with the reply)
function updateAiMessage(id, content) {
  const el = $(id);
  if (el) {
    el.querySelector('.msg-body').textContent = content;
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight; // Scroll down after update
  }
}


/* ══════════════════════════════════════════
   BREATHING EXERCISE
   A guided 4-7-8 breathing animation using phase-based timeouts.
══════════════════════════════════════════ */
const BREATH_PHASES = [
  { name: 'Inhale',  dur: 4000, cls: 'inhale', status: 'Breathe in slowly through your nose…' },  // 4 seconds
  { name: 'Hold',    dur: 7000, cls: 'hold',   status: 'Hold your breath gently…' },               // 7 seconds
  { name: 'Exhale',  dur: 8000, cls: 'exhale', status: 'Exhale completely through your mouth…' },  // 8 seconds
];

// Attach the click handler to start/stop breathing
$('breathRing')?.addEventListener('click', toggleBreathing);

function toggleBreathing() {
  if (breathActive) {
    // Stop the exercise
    breathActive = false;
    clearTimeout(breathTimerId); // Cancel the pending phase timeout
    const ring = $('breathRing');
    ring.className = 'breath-ring'; // Remove any phase CSS class (inhale/hold/exhale)
    setText('breathText',   'Tap to start');
    setText('breathStatus', 'Tap the circle to begin a calming breathing session');
  } else {
    // Start the exercise from the beginning
    breathActive = true;
    breathPhase  = 0;
    runBreathPhase();
  }
}

// Advances to the next breathing phase and schedules the one after
function runBreathPhase() {
  if (!breathActive) return; // Guard: stop if cancelled

  const phase  = BREATH_PHASES[breathPhase % 3]; // Use modulo to cycle: 0→1→2→0→1→2...
  const ring   = $('breathRing');
  ring.className = 'breath-ring ' + phase.cls;    // Apply CSS class that triggers the animation
  setText('breathText',   phase.name);
  setText('breathStatus', phase.status);
  breathPhase++;
  breathTimerId = setTimeout(runBreathPhase, phase.dur); // Schedule the next phase after this one's duration
}


/* ══════════════════════════════════════════
   NAVIGATION
   Bottom tab bar switching between app views.
══════════════════════════════════════════ */
function bindNavEvents() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view, btn));
  });
}

function switchView(name, btn) {
  // Hide all views and deactivate all nav items
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  // Show the target view
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');

  // Mark the clicked nav button as active (or find it if called programmatically without a btn reference)
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
  }

  // Scroll the content area back to the top when switching tabs
  document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ══════════════════════════════════════════
   PROFILE ACTIONS
══════════════════════════════════════════ */
// Wipes all stored data and reloads the page (restart from onboarding)
function resetApp() {
  if (!confirm('This will delete all your data and restart the onboarding. Are you sure?')) return;
  localStorage.clear(); // Remove everything stored under this origin
  location.reload();    // Force a full page refresh
}


/* ══════════════════════════════════════════
   GLOBAL EXPOSE
   These functions are called directly from HTML onclick="..." attributes,
   so they must be attached to window to be accessible from HTML.
══════════════════════════════════════════ */
window.obNext           = obNext;
window.finishOnboarding = finishOnboarding;
window.openTodoModal    = openTodoModal;
window.closeTodoModal   = closeTodoModal;
window.saveNewTodo      = saveNewTodo;
window.resetApp         = resetApp;
window.switchView        = switchView;


/* ══════════════════════════════════════════
   BOOT
   Entry point — runs once the HTML document is fully loaded.
══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  if (profile) {
    // Returning user: skip onboarding and go straight to the app
    $('onboarding').style.display = 'none';
    $('app').style.display = 'flex';
    initApp();
  }
  // Always initialise the onboarding progress bar to show "Step 1 of 5" (20%)
  $('obProgressBar').style.width = '20%';
});