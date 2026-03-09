import { useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable,
  ScrollView, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import client from '../api/client';

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

export default function SubmitOutcomeModal({ visible, onClose, onSubmitted, shop, dtcCode }) {
  const [fixSuccess, setFixSuccess]         = useState(null);   // true | false | null
  const [quotedCost, setQuotedCost]         = useState('');
  const [finalCost, setFinalCost]           = useState('');
  const [upsell, setUpsell]                 = useState(false);
  const [upsellDetail, setUpsellDetail]     = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState(null);

  function reset() {
    setFixSuccess(null);
    setQuotedCost('');
    setFinalCost('');
    setUpsell(false);
    setUpsellDetail('');
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (fixSuccess === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        shop_name:       shop.name,
        dtc_code:        dtcCode ?? 'UNKNOWN',
        fix_success:     fixSuccess,
        quoted_cost:     quotedCost !== '' ? parseFloat(quotedCost) : null,
        final_cost:      finalCost !== '' ? parseFloat(finalCost) : null,
        upsells_reported: upsell,
        upsell_detail:   upsell && upsellDetail.trim() ? upsellDetail.trim() : null,
      };
      const res = await client.post(`/mechanics/${shop.id}/outcome`, body);
      reset();
      onSubmitted(res.data.trust);
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={ST.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={ST.kavWrapper}
        >
          <View style={ST.sheet}>
            {/* Drag handle */}
            <View style={ST.handle} />

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Header */}
              <Text style={ST.title}>REPORT OUTCOME</Text>
              <Text style={ST.shopName}>{shop?.name}</Text>
              {dtcCode ? <Text style={ST.dtcPill}>{dtcCode}</Text> : null}

              {/* Field 1: Was the issue fixed? */}
              <Text style={ST.label}>WAS THE ISSUE FIXED?</Text>
              <View style={ST.toggleRow}>
                <Pressable
                  style={[ST.toggleBtn, fixSuccess === true && ST.toggleYes]}
                  onPress={() => setFixSuccess(true)}
                >
                  <Text style={[ST.toggleTxt, fixSuccess === true && { color: C.open }]}>YES</Text>
                </Pressable>
                <Pressable
                  style={[ST.toggleBtn, fixSuccess === false && ST.toggleNo]}
                  onPress={() => setFixSuccess(false)}
                >
                  <Text style={[ST.toggleTxt, fixSuccess === false && { color: C.closed }]}>NO</Text>
                </Pressable>
              </View>

              {/* Field 2: Quoted cost */}
              <Text style={ST.label}>QUOTED COST ($)</Text>
              <TextInput
                style={ST.input}
                value={quotedCost}
                onChangeText={setQuotedCost}
                keyboardType="decimal-pad"
                placeholder="e.g. 350"
                placeholderTextColor={C.textMuted}
              />

              {/* Field 3: Final cost */}
              <Text style={ST.label}>FINAL COST PAID ($)</Text>
              <TextInput
                style={ST.input}
                value={finalCost}
                onChangeText={setFinalCost}
                keyboardType="decimal-pad"
                placeholder="e.g. 420"
                placeholderTextColor={C.textMuted}
              />

              {/* Field 4: Upsold? */}
              <Text style={ST.label}>WERE YOU UPSOLD UNNECESSARY SERVICES?</Text>
              <View style={ST.toggleRow}>
                <Pressable
                  style={[ST.toggleBtn, upsell && ST.toggleNo]}
                  onPress={() => setUpsell(true)}
                >
                  <Text style={[ST.toggleTxt, upsell && { color: C.closed }]}>YES</Text>
                </Pressable>
                <Pressable
                  style={[ST.toggleBtn, !upsell && ST.toggleActive]}
                  onPress={() => setUpsell(false)}
                >
                  <Text style={[ST.toggleTxt, !upsell && { color: C.accent }]}>NO</Text>
                </Pressable>
              </View>

              {/* Field 5: Upsell detail — conditional */}
              {upsell && (
                <>
                  <Text style={ST.label}>UPSELL DETAILS (OPTIONAL)</Text>
                  <TextInput
                    style={[ST.input, ST.inputMultiline]}
                    value={upsellDetail}
                    onChangeText={t => setUpsellDetail(t.slice(0, 200))}
                    multiline
                    numberOfLines={3}
                    placeholder="Describe what was pushed on you…"
                    placeholderTextColor={C.textMuted}
                    maxLength={200}
                  />
                  <Text style={ST.charCount}>{upsellDetail.length}/200</Text>
                </>
              )}

              {/* Error */}
              {error ? <Text style={ST.errorTxt}>{error}</Text> : null}

              {/* Submit */}
              <Pressable
                style={({ pressed }) => [
                  ST.submitBtn,
                  fixSuccess === null && ST.submitDisabled,
                  pressed && fixSuccess !== null && ST.pressed,
                ]}
                onPress={handleSubmit}
                disabled={fixSuccess === null || submitting}
              >
                {submitting
                  ? <ActivityIndicator color={C.bg} />
                  : <Text style={ST.submitTxt}>SUBMIT REPORT</Text>
                }
              </Pressable>

              {/* Cancel */}
              <Pressable style={ST.cancelBtn} onPress={handleClose} disabled={submitting}>
                <Text style={ST.cancelTxt}>CANCEL</Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const ST = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  kavWrapper: { width: '100%' },
  sheet: {
    backgroundColor: '#141414',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    borderRadius: 0,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '92%',
  },
  handle: {
    width: 40, height: 3,
    backgroundColor: '#3A3A3A',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12, marginBottom: 20,
  },
  title: {
    color: '#C0C0C0', fontSize: 14, fontWeight: '800',
    letterSpacing: 2.5, marginBottom: 4,
  },
  shopName: {
    color: '#E0E0E0', fontSize: 16, fontWeight: '700', marginBottom: 6,
  },
  dtcPill: {
    color: '#C0C0C0', fontSize: 11, fontWeight: '700',
    letterSpacing: 1, marginBottom: 20,
    backgroundColor: 'rgba(192,192,192,0.08)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  label: {
    color: '#505050', fontSize: 9, fontWeight: '800',
    letterSpacing: 1.5, marginBottom: 8, marginTop: 20,
  },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: {
    flex: 1, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 0, backgroundColor: '#1A1A1A',
  },
  toggleYes: {
    borderColor: '#4CAF82',
    backgroundColor: 'rgba(76,175,130,0.10)',
  },
  toggleNo: {
    borderColor: '#D0453A',
    backgroundColor: 'rgba(208,69,58,0.10)',
  },
  toggleActive: {
    borderColor: '#C0C0C0',
    backgroundColor: 'rgba(192,192,192,0.08)',
  },
  toggleTxt: {
    color: '#505050', fontSize: 13, fontWeight: '800', letterSpacing: 1.5,
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 0,
    color: '#E0E0E0',
    fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  inputMultiline: {
    height: 80, textAlignVertical: 'top',
  },
  charCount: {
    color: '#505050', fontSize: 10, textAlign: 'right', marginTop: 4,
  },
  errorTxt: {
    color: '#D0453A', fontSize: 13, marginTop: 16, lineHeight: 19,
  },
  submitBtn: {
    marginTop: 28,
    backgroundColor: '#C0C0C0',
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 0,
  },
  submitDisabled: {
    backgroundColor: '#2A2A2A',
  },
  submitTxt: {
    color: '#080808', fontSize: 13, fontWeight: '800', letterSpacing: 1.5,
  },
  cancelBtn: {
    marginTop: 12, paddingVertical: 14, alignItems: 'center',
  },
  cancelTxt: {
    color: '#505050', fontSize: 12, fontWeight: '700', letterSpacing: 1.5,
  },
  pressed: { opacity: 0.65 },
});
