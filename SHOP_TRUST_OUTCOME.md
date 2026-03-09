# Shop Trust Score — Submit Outcome Flow

Implement the full "Report Outcome" user flow in MechanicFinderScreen. Work inside `/Users/dadon/autoalert/`.

---

## Overview

Users can currently SEE a shop's ODIN Trust Score but cannot SUBMIT data. This task adds:

1. A "Report Outcome" button on each mechanic card
2. A `SubmitOutcomeModal` bottom sheet with the submission form
3. A `TrustBreakdownModal` — tapping the trust badge shows score components
4. Optimistic trust score refresh after a successful submission

Do NOT touch the backend — routes and scoring logic are already complete.

---

## Design System

Match the existing cyberpunk HUD palette exactly:

```js
const C = {
  bg:           '#080808',
  surface:      '#1A1A1A',
  surfaceAlt:   '#141414',
  border:       '#2A2A2A',
  borderGlow:   '#3A3A3A',
  accent:       '#C0C0C0',
  accentDim:    'rgba(192,192,192,0.08)',
  open:         '#4CAF82',
  openBg:       'rgba(76,175,130,0.12)',
  closed:       '#D0453A',
  closedBg:     'rgba(208,69,58,0.12)',
  gold:         '#C08B30',
  textPrimary:  '#E0E0E0',
  textSecondary:'#777777',
  textMuted:    '#505050',
};
```

All UI elements must use:
- `borderRadius: 0` (sharp corners throughout)
- `letterSpacing` on all caps labels
- No shadows — use border glow via `borderColor` instead

---

## Task 1 — SubmitOutcomeModal component

Create `/Users/dadon/autoalert/src/components/SubmitOutcomeModal.js`

### Props
```js
{
  visible: bool,
  onClose: fn,
  onSubmitted: fn(trustData),  // called with fresh trust object after success
  shop: { id, name },
  dtcCode: string | null,      // pre-fill if coming from a DTC scan
}
```

### Form fields
1. **Was the issue fixed?** — Two large toggle buttons: YES (green) / NO (red). Required.
2. **Quoted cost** — numeric TextInput, optional, placeholder "e.g. 350"
3. **Final cost paid** — numeric TextInput, optional, placeholder "e.g. 420"
4. **Were you upsold unnecessary services?** — toggle YES / NO, default NO
5. **Upsell details** — multiline TextInput, only visible if upsell = YES, optional, max 200 chars

### Behavior
- Modal slides up from bottom using `Modal` with `animationType="slide"`
- Dark overlay behind the sheet
- Sheet has a drag handle indicator at the top
- "SUBMIT REPORT" button at the bottom — disabled until fix_success is selected
- On submit: POST to `/api/mechanics/:shop_id/outcome` via `client` (axios instance at `../api/client`)
- Show `ActivityIndicator` while submitting
- On success: call `onSubmitted(res.data.trust)` then close
- On error: show inline error message in red, do not close

### Request body
```js
{
  shop_name: shop.name,
  dtc_code: dtcCode ?? 'UNKNOWN',
  fix_success: bool,
  quoted_cost: number | null,
  final_cost: number | null,
  upsells_reported: bool,
  upsell_detail: string | null,
}
```

---

## Task 2 — TrustBreakdownModal component

Create `/Users/dadon/autoalert/src/components/TrustBreakdownModal.js`

### Props
```js
{
  visible: bool,
  onClose: fn,
  trust: {
    score: number,
    tier: string,
    tier_color: string,
    outcome_count: number,
    components: {
      cost_accuracy: { score, max, detail },
      fix_success:   { score, max, detail },
      upsell:        { penalty, max, detail },
    }
  } | null,
}
```

### Layout
- Modal slides up from bottom
- Title: "ODIN TRUST SCORE" in accent color
- Large score display: e.g. "74" in tier color, with tier label below ("GOOD")
- Three component rows with labels and bar indicators:
  - COST ACCURACY — `score / max` filled bar, detail text below
  - FIX SUCCESS RATE — `score / max` filled bar, detail text below  
  - UPSELL PENALTY — `penalty / max` filled bar in red, detail text below
- Outcome count at bottom: "Based on X user reports"
- "CLOSE" button at bottom

### Bar component
```js
// Each bar: thin horizontal bar, filled portion uses tier_color (cost/fix) or C.closed (upsell)
// Height: 3px, full width of container
// Animate fill width on mount using Animated.timing
```

---

## Task 3 — Update MechanicFinderScreen.js

### 3a — Update TrustBadge component

- Make the trust pill `Pressable` 
- On press: set `breakdownVisible = true` to open `TrustBreakdownModal`
- Add `TrustBreakdownModal` instance inside `TrustBadge`
- Add a refresh function: `refreshTrust(newTrust)` that updates local trust state when outcome is submitted

### 3b — Update MechanicCard component

Add a "Report Outcome" button below the existing action buttons:

```js
<Pressable
  style={({ pressed }) => [ST.reportBtn, pressed && ST.pressed]}
  onPress={() => setOutcomeModalVisible(true)}
>
  <Text style={ST.reportBtnTxt}>⊕  REPORT OUTCOME</Text>
</Pressable>
```

- Add `outcomeModalVisible` state to `MechanicCard`
- Add `SubmitOutcomeModal` inside `MechanicCard`, pass `shop`, `dtcCode` from parent
- On `onSubmitted(trust)`: call a `onTrustUpdate(trust)` prop passed down from the screen
- Pass `dtcCode` from `MechanicFinderScreen` → `MechanicCard` → `SubmitOutcomeModal`

### 3c — New styles to add to ST StyleSheet

```js
// Report button
reportBtn: {
  marginTop: 8,
  borderWidth: 1,
  borderColor: '#2A2A2A',
  borderStyle: 'dashed',
  paddingVertical: 10,
  alignItems: 'center',
  borderRadius: 0,
},
reportBtnTxt: {
  color: '#505050',
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.5,
},
```

---

## Task 4 — Wire trust refresh in MechanicFinderScreen

In `MechanicFinderScreen`, update `FlatList renderItem` to pass `onTrustUpdate` to `MechanicCard`.

`TrustBadge` should accept an `externalTrust` prop — if provided, use it instead of the fetched trust. This lets `MechanicCard` push a fresh trust object into the badge after a submission without re-fetching.

---

## Auth note

`SubmitOutcomeModal` posts to an authenticated endpoint. The `client` axios instance at `src/api/client.js` already attaches the JWT from secure storage via an interceptor — no manual token handling needed.

---

## Verification checklist

After implementation, confirm:
- [ ] "REPORT OUTCOME" button appears on every mechanic card
- [ ] Tapping it opens the bottom sheet modal
- [ ] Form validates — SUBMIT disabled until fix_success is selected
- [ ] Successful submission closes modal and updates the trust badge immediately
- [ ] Tapping the trust pill opens the breakdown modal with score bars
- [ ] All modals dismiss cleanly (no stuck overlays)
- [ ] No TypeErrors when `trust` is null (new shop with no data)
- [ ] Upsell detail field only appears when upsell toggle = YES
