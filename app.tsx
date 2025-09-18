// App.tsx — ConsumptieTracker (Expo + React Native)
// Works on Windows dev machine with Expo Go (iOS/Android). Build iOS via EAS cloud when ready.
// Features: add items (bier/fris/snoep), adjustable base price (fris/snoep), bier = 2x, lock price at purchase,
// list + filter unpaid, create payment batches, totals, CSV share. Local storage via AsyncStorage.

import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Pressable, FlatList, Switch, Share, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';

// --- Types ---
export type ItemType = 'Bier' | 'Fris' | 'Snoep';
export type Item = {
  uuid: string;
  type: ItemType;
  date: string; // ISO
  priceCents: number; // locked at purchase
  userLabel?: string;
  paidAt?: string; // ISO
  paymentId?: string;
};
export type Settings = {
  basePriceCents: number; // for Fris/Snoep, Bier=2x
  currencyCode: string; // e.g., EUR
};
export type PaymentBatch = {
  id: string;
  createdAt: string;
  note?: string;
};

// --- Storage Keys ---
const K_ITEMS = 'ct.items.v1';
const K_SETTINGS = 'ct.settings.v1';
const K_PAYMENTS = 'ct.payments.v1';

// --- Helpers ---
const fmtCurrency = (cents: number, code: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(cents / 100);

const nowISO = () => new Date().toISOString();

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
async function saveJSON<T>(key: string, value: T) { await AsyncStorage.setItem(key, JSON.stringify(value)); }

// --- App ---
export default function App() {
  const [tab, setTab] = useState<'add' | 'list' | 'pay' | 'settings'>('add');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <StatusBar style="light" />
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>ConsumptieTracker</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'add' && <AddScreen />}
        {tab === 'list' && <OverviewScreen />}
        {tab === 'pay' && <PaymentsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
      <NavBar tab={tab} setTab={setTab} />
    </SafeAreaView>
  );
}

function NavBar({ tab, setTab }: { tab: any, setTab: (t: any) => void }) {
  const tabs: { key: any, label: string }[] = [
    { key: 'add', label: 'Toevoegen' },
    { key: 'list', label: 'Overzicht' },
    { key: 'pay', label: 'Betalingen' },
    { key: 'settings', label: 'Instellingen' },
  ];
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#222' }}>
      {tabs.map(t => (
        <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, padding: 12, backgroundColor: tab === t.key ? '#111' : '#0b0b0b' }}>
          <Text style={{ color: tab === t.key ? 'white' : '#aaa', textAlign: 'center' }}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// --- Global State hooks (very simple) ---
function useSettings() {
  const [settings, setSettings] = useState<Settings>({ basePriceCents: 70, currencyCode: 'EUR' });
  useEffect(() => { loadJSON<Settings>(K_SETTINGS, settings).then(setSettings); }, []);
  useEffect(() => { saveJSON(K_SETTINGS, settings); }, [settings]);
  return { settings, setSettings };
}
function useItems() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { loadJSON<Item[]>(K_ITEMS, []).then(setItems); }, []);
  useEffect(() => { saveJSON(K_ITEMS, items); }, [items]);
  return { items, setItems };
}
function usePayments() {
  const [payments, setPayments] = useState<PaymentBatch[]>([]);
  useEffect(() => { loadJSON<PaymentBatch[]>(K_PAYMENTS, []).then(setPayments); }, []);
  useEffect(() => { saveJSON(K_PAYMENTS, payments); }, [payments]);
  return { payments, setPayments };
}

// --- Add Screen ---
function AddScreen() {
  const { settings } = useSettings();
  const { items, setItems } = useItems();
  const [type, setType] = useState<ItemType>('Fris');
  const [date, setDate] = useState<string>(nowISO());
  const [userLabel, setUserLabel] = useState<string>('');

  const priceCents = useMemo(() => type === 'Bier' ? settings.basePriceCents * 2 : settings.basePriceCents, [type, settings]);

  const add = async () => {
    const uuid = await Crypto.randomUUID();
    const item: Item = { uuid, type, date, priceCents, userLabel };
    setItems([item, ...items]);
    setDate(nowISO());
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Row>
        <Text style={label}>Type</Text>
        <Segmented value={type} onChange={setType} options={['Fris','Snoep','Bier']} />
      </Row>
      <Row>
        <Text style={label}>Datum</Text>
        <Text style={value}>{new Date(date).toLocaleString()}</Text>
      </Row>
      <Row>
        <Text style={label}>Naam (optioneel)</Text>
        <TextInput value={userLabel} onChangeText={setUserLabel} placeholder="bv. Koen" placeholderTextColor="#666" style={input} />
      </Row>
      <Row>
        <Text style={label}>Prijs</Text>
        <Text style={[value, { fontWeight: '700' }]}>{fmtCurrency(priceCents, settings.currencyCode)}</Text>
      </Row>
      <PrimaryButton title="Opslaan" onPress={add} />
    </View>
  );
}

// --- Overview Screen ---
function OverviewScreen() {
  const { settings } = useSettings();
  const { items, setItems } = useItems();
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => items.filter(it => (
    (!onlyUnpaid || !it.paidAt) &&
    (search === '' || it.userLabel?.toLowerCase().includes(search.toLowerCase()) || it.type.toLowerCase().includes(search.toLowerCase()))
  )), [items, onlyUnpaid, search]);

  const toggleSelect = (id: string) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const selectedItems = filtered.filter(it => selected[it.uuid]);
  const totalCents = selectedItems.reduce((a, b) => a + b.priceCents, 0);

  return (
    <View style={{ flex: 1, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
        <Switch value={onlyUnpaid} onValueChange={setOnlyUnpaid} />
        <Text style={{ color: 'white' }}>Toon alleen openstaand</Text>
      </View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Zoeken op naam of type" placeholderTextColor="#666" style={[input, { marginBottom: 8 }]} />
      <Text style={{ color: '#aaa', marginBottom: 6 }}>Totaal: {fmtCurrency(filtered.reduce((a,b)=>a+b.priceCents,0), settings.currencyCode)}</Text>
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.uuid}
        renderItem={({ item }) => (
          <Pressable onPress={() => toggleSelect(item.uuid)} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111', flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: 'white', fontWeight: '700' }}>{item.type} — {fmtCurrency(item.priceCents, settings.currencyCode)}</Text>
              <Text style={{ color: '#aaa', fontSize: 12 }}>{new Date(item.date).toLocaleString()} {item.userLabel ? `• ${item.userLabel}` : ''}</Text>
            </View>
            <Text style={{ color: item.paidAt ? '#4ade80' : '#f59e0b' }}>{item.paidAt ? 'Betaald' : 'Open'}</Text>
          </Pressable>
        )}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
        <Text style={{ color: '#aaa' }}>Geselecteerd: {selectedItems.length} • {fmtCurrency(totalCents, settings.currencyCode)}</Text>
        <PrimaryButton title="Afrekenen" onPress={() => createPayment(selectedItems, { items, setItems })} disabled={selectedItems.length === 0} />
      </View>
    </View>
  );
}

async function createPayment(sel: Item[], ctx: { items: Item[], setItems: (arr: Item[]) => void }) {
  const id = await Crypto.randomUUID();
  const batch: PaymentBatch = { id, createdAt: nowISO() };
  const payments = await loadJSON<PaymentBatch[]>(K_PAYMENTS, []);
  await saveJSON(K_PAYMENTS, [batch, ...payments]);
  const updated = ctx.items.map(it => sel.find(s => s.uuid === it.uuid) ? { ...it, paidAt: nowISO(), paymentId: id } : it);
  ctx.setItems(updated);
  Alert.alert('Afrekenen', 'Geselecteerde items gemarkeerd als betaald.');
}

// --- Payments Screen ---
function PaymentsScreen() {
  const { settings } = useSettings();
  const { items } = useItems();
  const { payments, setPayments } = usePayments();

  const totalFor = (p: PaymentBatch) => items.filter(it => it.paymentId === p.id).reduce((a,b)=>a+b.priceCents,0);

  const shareCSV = async (p: PaymentBatch) => {
    const rows = ['type,prijs_cents,datum,user,betaald_op,batch_id'];
    items.filter(it => it.paymentId === p.id).forEach(it => rows.push([
      it.type,
      it.priceCents,
      it.date,
      it.userLabel ?? '',
      it.paidAt ?? '',
      p.id,
    ].join(',')));
    await Share.share({ message: rows.join('\n') });
  };

  const remove = async (p: PaymentBatch) => {
    const its = items.map(it => it.paymentId === p.id ? ({ ...it, paymentId: undefined, paidAt: undefined }) : it);
    await saveJSON(K_ITEMS, its);
    setPayments(payments.filter(x => x.id !== p.id));
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={payments}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#111' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: 'white', fontWeight: '700' }}>{new Date(item.createdAt).toLocaleString()}</Text>
              <Text style={{ color: 'white' }}>{fmtCurrency(totalFor(item), settings.currencyCode)}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
              <SecondaryButton title="CSV" onPress={() => shareCSV(item)} />
              <DangerButton title="Verwijder" onPress={() => remove(item)} />
            </View>
          </View>
        )}
      />
    </View>
  );
}

// --- Settings Screen ---
function SettingsScreen() {
  const { settings, setSettings } = useSettings();
  const [base, setBase] = useState((settings.basePriceCents/100).toFixed(2));
  const [code, setCode] = useState(settings.currencyCode);

  useEffect(() => { setBase((settings.basePriceCents/100).toFixed(2)); setCode(settings.currencyCode); }, [settings]);

  const save = () => {
    const cents = Math.round(parseFloat(base.replace(',','.')) * 100);
    if (isNaN(cents) || cents <= 0) return Alert.alert('Fout', 'Voer een geldige prijs in.');
    setSettings({ basePriceCents: cents, currencyCode: code || 'EUR' });
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Row>
        <Text style={label}>Fris/Snoep</Text>
        <TextInput value={base} onChangeText={setBase} style={[input, { width: 100, textAlign: 'right' }]} />
      </Row>
      <Row>
        <Text style={label}>Bier (auto)</Text>
        <Text style={value}>{(parseFloat(base.replace(',','.'))*2 || 0).toFixed(2)}</Text>
      </Row>
      <Row>
        <Text style={label}>Valuta</Text>
        <TextInput value={code} onChangeText={setCode} autoCapitalize='characters' style={[input, { width: 100, textAlign: 'right' }]} />
      </Row>
      <PrimaryButton title="Opslaan" onPress={save} />
    </View>
  );
}

// --- UI primitives ---
const Row = ({ children }: any) => (<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>{children}</View>);
const label = { color: '#ddd', fontSize: 16 } as const;
const value = { color: 'white', fontSize: 16 } as const;
const input = { backgroundColor: '#131313', borderWidth: 1, borderColor: '#222', color: 'white', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 } as const;

function PrimaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean; }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ backgroundColor: disabled ? '#333' : '#2563eb', padding: 12, borderRadius: 10, minWidth: 120 }}>
      <Text style={{ color: 'white', textAlign: 'center', fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}
function SecondaryButton({ title, onPress }: { title: string; onPress: () => void; }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: '#0f172a', padding: 10, borderRadius: 10 }}>
      <Text style={{ color: 'white' }}>{title}</Text>
    </Pressable>
  );
}
function DangerButton({ title, onPress }: { title: string; onPress: () => void; }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: '#7f1d1d', padding: 10, borderRadius: 10 }}>
      <Text style={{ color: 'white' }}>{title}</Text>
    </Pressable>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: any) => void; options: string[] }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: '#111', borderRadius: 10, borderWidth: 1, borderColor: '#222' }}>
      {options.map(opt => (
        <Pressable key={opt} onPress={() => onChange(opt as any)} style={{ paddingVertical: 8, paddingHorizontal: 12, backgroundColor: value === opt ? '#1f2937' : 'transparent', borderRadius: 10 }}>
          <Text style={{ color: 'white' }}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}
