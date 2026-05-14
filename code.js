const ENABLE_ACTIVATION_FLOW = false;

// ==================== グローバル変数 ====================
let MEMORY_CACHE = null;
let SYSTEM_API_ERROR_OCCURRED = false;

// ==================== doGet ====================
function doGet(e) {
  const html = HtmlService.createTemplateFromFile('index');
  const params = e && e.parameter ? e.parameter : {};
  html.initialView = params.view || '';
  html.initialGroupId = params.group || '';
  const activationCheck = checkUserActivation();
  html.activationSettings = {
    enabled: ENABLE_ACTIVATION_FLOW,
    isActivated: activationCheck.isActivated,
    userEmail: activationCheck.userEmail
  };
  return html.evaluate()
    .setTitle('Group Calendar')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==================== URL取得 ====================
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ==================== キャッシュ管理 ====================
function loadNameCache() {
  if (MEMORY_CACHE) return;
  try {
    const json = PropertiesService.getUserProperties().getProperty('NAME_CACHE_V2');
    MEMORY_CACHE = json ? JSON.parse(json) : {};
  } catch (e) { MEMORY_CACHE = {}; }
}

function saveNameCache() {
  if (!MEMORY_CACHE) return;
  try {
    const json = JSON.stringify(MEMORY_CACHE);
    if (json.length > 8500) {
      const entries = Object.entries(MEMORY_CACHE).sort((a,b) => (a[1].timestamp||0) - (b[1].timestamp||0));
      const rm = Math.floor(entries.length / 2);
      for (let i = 0; i < rm; i++) delete MEMORY_CACHE[entries[i][0]];
    }
    PropertiesService.getUserProperties().setProperty('NAME_CACHE_V2', JSON.stringify(MEMORY_CACHE));
  } catch (e) { console.error("Cache save failed:", e); }
}

function saveSyncToken(calId, token) {
  try { PropertiesService.getUserProperties().setProperty('ST_' + calId, token); } catch(e){}
}
function getSyncToken(calId) {
  try { return PropertiesService.getUserProperties().getProperty('ST_' + calId); } catch(e){ return null; }
}
function clearSyncToken(calId) {
  try { PropertiesService.getUserProperties().deleteProperty('ST_' + calId); } catch(e){}
}

function getEventCache(calId, rangeKey) {
  try {
    const d = CacheService.getUserCache().get('EV_' + calId + '_' + rangeKey);
    return d ? JSON.parse(d) : null;
  } catch(e){ return null; }
}
function setEventCache(calId, rangeKey, data) {
  try {
    const j = JSON.stringify(data);
    if (j.length < 100000) CacheService.getUserCache().put('EV_' + calId + '_' + rangeKey, j, 21600);
  } catch(e){}
}

// ==================== 名前解決 ====================
function resolvePersonInfo(email, fallbackName, onlyCacheOrFallback) {
  const e = email.trim();
  if (!e) return { name: '', photoUrl: null };
  const EXP = 30*24*60*60*1000;
  const now = Date.now();
  if (!MEMORY_CACHE) MEMORY_CACHE = {};
  let cached = MEMORY_CACHE[e];
  let useCache = true;
  if (cached) {
    const idPart = e.split('@')[0];
    if ((!cached.name || cached.name.includes('@') || cached.name === idPart) && fallbackName && !fallbackName.includes('@') && fallbackName !== idPart) useCache = false;
    if (!cached.timestamp || (now - cached.timestamp > EXP)) useCache = false;
  }
  if (cached && useCache) return cached;
  if (onlyCacheOrFallback) return { name: fallbackName || e.split('@')[0], photoUrl: cached ? cached.photoUrl : null };

  let rName = null, rPhoto = cached ? cached.photoUrl : null, hasErr = false;
  // 1. 自分
  try {
    if (e === Session.getActiveUser().getEmail()) {
      const p = People.People.get('people/me', { personFields: 'names,photos' });
      if (p) { if (p.names && p.names.length) rName = p.names[0].displayName; if (p.photos && p.photos.length) rPhoto = p.photos[0].url; }
    }
  } catch(err) { hasErr = true; SYSTEM_API_ERROR_OCCURRED = true; }
  // 2. ディレクトリ
  if (!rName) { try {
    const r = People.People.searchDirectoryPeople({ query: e, readMask: 'names,photos', sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE','DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT'] });
    if (r.people && r.people.length) { const p = r.people[0]; if (p.names && p.names.length) rName = p.names[0].displayName; if (!rPhoto && p.photos && p.photos.length) rPhoto = p.photos[0].url; }
  } catch(err) { hasErr = true; SYSTEM_API_ERROR_OCCURRED = true; }}
  // 3. 連絡先
  if (!rName) { try {
    const r = People.People.searchContacts({ query: e, readMask: 'names,photos', sources: ['READ_SOURCE_TYPE_CONTACT'] });
    if (r.results && r.results.length) { const p = r.results[0].person; if (p.names && p.names.length) rName = p.names[0].displayName; if (!rPhoto && p.photos && p.photos.length) rPhoto = p.photos[0].url; }
  } catch(err) { hasErr = true; SYSTEM_API_ERROR_OCCURRED = true; }}
  // 4. フォールバック
  if (!rName && fallbackName && fallbackName !== e && fallbackName.toLowerCase() !== 'events') rName = fallbackName;
  if (!rName) rName = (cached && cached.name) ? cached.name : e.split('@')[0];
  const result = { name: rName, photoUrl: rPhoto, timestamp: now };
  if (!hasErr) MEMORY_CACHE[e] = result;
  return result;
}

function executeCacheWarmUp(emails) {
  if (SYSTEM_API_ERROR_OCCURRED) return;
  const EXP = 30*24*60*60*1000, now = Date.now();
  const cands = [];
  emails.forEach(e => { const c = MEMORY_CACHE[e]; if (!c || !c.timestamp || (now - c.timestamp > EXP)) cands.push(e); });
  if (!cands.length) return;
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [cands[i],cands[j]] = [cands[j],cands[i]]; }
  cands.slice(0, 3).forEach(em => { if (!SYSTEM_API_ERROR_OCCURRED) resolvePersonInfo(em, '', false); });
}

// ==================== Calendar REST API ====================
const COLOR_MAP = {'1':'#7986cb','2':'#33b679','3':'#8e24aa','4':'#e67c73','5':'#f6bf26','6':'#f4511e','7':'#039be5','8':'#616161','9':'#3f51b5','10':'#0b8043','11':'#d50000'};
function getColorHex(id) { return COLOR_MAP[id] || '#4285F4'; }

function convertStatus_(s) { return {'accepted':'YES','declined':'NO','tentative':'MAYBE','needsAction':'INVITED'}[s] || 'INVITED'; }

function convertEvent_(item, calendarOwnerEmail) {
  if (item.status === 'cancelled') return { id: item.id, deleted: true };
  let isAllDay = !!(item.start && item.start.date);
  let startStr = isAllDay ? item.start.date + 'T00:00:00+09:00' : (item.start.dateTime || new Date(item.start.date).toISOString());
  let endStr = isAllDay ? item.end.date + 'T00:00:00+09:00' : (item.end.dateTime || new Date(item.end.date).toISOString());
  
  // 0:00-0:00 (同日または翌日)の予定を終日扱いに
  if (!isAllDay) {
    const sD = new Date(startStr), eD = new Date(endStr);
    if (sD.getHours() === 0 && sD.getMinutes() === 0 && eD.getHours() === 0 && eD.getMinutes() === 0 && eD.getTime() > sD.getTime()) {
      const dayDiff = Math.round((eD.getTime() - sD.getTime()) / (24*60*60*1000));
      if (dayDiff >= 1) isAllDay = true;
    }
  }
  
  let color = '#4285F4';
  if (item.colorId) color = getColorHex(item.colorId);
  
  // 自分の非公開予定は詳細表示
  const myEmail = Session.getActiveUser().getEmail();
  const isOwnCalendar = calendarOwnerEmail === myEmail;
  let title = item.summary || '';
  const visibility = item.visibility || 'default';
  if (visibility === 'private' && !isOwnCalendar) {
    title = '非公開';
  }
  
  const guests = (item.attendees || []).map(a => {
    const ge = a.email || '';
    let gn = a.displayName || ge.split('@')[0];
    const ci = resolvePersonInfo(ge, gn, true);
    return { email: ge, name: ci.name || gn, status: convertStatus_(a.responseStatus), type: a.organizer ? 'creator' : 'guest', self: a.self || false };
  });
  const creators = [];
  if (item.creator) { const ci = resolvePersonInfo(item.creator.email||'', item.creator.displayName||'', true); creators.push({ email: item.creator.email||'', name: ci.name || (item.creator.email||'').split('@')[0], type: 'creator' }); }
  return { id: item.id, title, start: startStr, end: endStr, isAllDay, color, description: (visibility === 'private' && !isOwnCalendar) ? '' : (item.description||''), location: (visibility === 'private' && !isOwnCalendar) ? '' : (item.location||''), creators, guests, visibility, lastUpdated: item.updated||new Date().toISOString(), htmlLink: item.htmlLink||'', status: item.status||'confirmed' };
}

function fetchCalendarEventsREST(calId, timeMin, timeMax, force) {
  let calColor = null, calName = '', events = [], newSync = null;
  const rangeKey = timeMin + '_' + timeMax;
  if (!force) { const c = getEventCache(calId, rangeKey); if (c && c.events) return c; }
  try {
    try {
      const m = Calendar.CalendarList.get(calId);
      if (m) { calColor = m.backgroundColor || null; calName = m.summaryOverride || m.summary || ''; }
    } catch(e) {
      try { Calendar.CalendarList.insert({ id: calId, hidden: true, selected: false }); const m = Calendar.CalendarList.get(calId); if (m) { calColor = m.backgroundColor; calName = m.summaryOverride || m.summary || ''; } }
      catch(e2) { return { events:[], calendarColor:null, calendarName:'', error:'not_found' }; }
    }
    // フルフェッチ
    let pt = null;
    do {
      const opt = { timeMin, timeMax, maxResults: 2500, singleEvents: true, orderBy: 'startTime' };
      if (pt) opt.pageToken = pt;
      const r = Calendar.Events.list(calId, opt);
      if (r.items) r.items.forEach(i => events.push(convertEvent_(i, calId)));
      pt = r.nextPageToken; newSync = r.nextSyncToken || newSync;
    } while (pt);
    if (newSync) saveSyncToken(calId, newSync);
    // 終日予定の重複排除（同タイトル・同日の終日イベント）
    const nonDeleted = events.filter(e => !e.deleted);
    const seen = new Set();
    const dedupEvents = nonDeleted.filter(e => {
      if (!e.isAllDay) return true;
      const key = e.title + '|' + e.start;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const res = { events: dedupEvents, calendarColor: calColor, calendarName: calName, error: null, lastFetched: Date.now() };
    setEventCache(calId, rangeKey, res);
    return res;
  } catch(e) {
    console.error('[CalAPI] Error for ' + calId + ':', e);
    return { events:[], calendarColor: calColor, calendarName: calName, error:'fetch_failed' };
  }
}

// ==================== メイン取得関数 ====================
function getCalendarEvents(startStr, endStr, targetEmails, forceRefresh) {
  SYSTEM_API_ERROR_OCCURRED = false;
  if (forceRefresh) { MEMORY_CACHE = {}; } else { loadNameCache(); }
  const initCache = JSON.stringify(MEMORY_CACHE || {});
  if (!targetEmails || !targetEmails.length) return JSON.stringify([]);
  const encountered = new Set();
  const result = [];
  // 全参加者のメールアドレスを収集
  const guestEmails = new Set();
  targetEmails.forEach(raw => {
    const email = raw.trim(); if (!email) return;
    encountered.add(email);
    const calData = fetchCalendarEventsREST(email, startStr, endStr, forceRefresh);
    let pi = resolvePersonInfo(email, calData.calendarName || '', false);
    let calName = pi.name, photoUrl = pi.photoUrl;
    if (calData.calendarName && calData.calendarName !== email) { pi = resolvePersonInfo(email, calData.calendarName, false); calName = pi.name; if (pi.photoUrl) photoUrl = pi.photoUrl; }
    (calData.events || []).forEach(evt => {
      if (evt.deleted) return;
      (evt.guests||[]).forEach(g => { if(g.email) { encountered.add(g.email); guestEmails.add(g.email); } });
      (evt.creators||[]).forEach(c => { if(c.email) { encountered.add(c.email); guestEmails.add(c.email); } });
    });
    result.push({ id: email, name: calName || email, email, photoUrl, color: calData.calendarColor, events: (calData.events||[]).filter(e => !e.deleted), errorType: calData.error || null });
  });
  
  // 未解決の参加者名をバッチで解決（最大10件）
  const unresolvedGuests = [];
  guestEmails.forEach(ge => {
    const cached = MEMORY_CACHE[ge];
    const idPart = ge.split('@')[0];
    if (!cached || !cached.name || cached.name.includes('@') || cached.name === idPart) unresolvedGuests.push(ge);
  });
  if (!SYSTEM_API_ERROR_OCCURRED && unresolvedGuests.length > 0) {
    unresolvedGuests.slice(0, 10).forEach(ge => resolvePersonInfo(ge, '', false));
    // 解決した名前をイベントに反映
    result.forEach(r => {
      (r.events || []).forEach(evt => {
        (evt.guests||[]).forEach(g => {
          const c = MEMORY_CACHE[g.email];
          if (c && c.name && !c.name.includes('@')) g.name = c.name;
        });
        (evt.creators||[]).forEach(c => {
          const cc = MEMORY_CACHE[c.email];
          if (cc && cc.name && !cc.name.includes('@')) c.name = cc.name;
        });
      });
    });
  }
  
  try { if (!SYSTEM_API_ERROR_OCCURRED) executeCacheWarmUp(encountered); } catch(e){}
  if (JSON.stringify(MEMORY_CACHE||{}) !== initCache) saveNameCache();
  return JSON.stringify(result);
}

// ==================== イベントCRUD ====================
function createEvent(calendarId, eventData) {
  try {
    const res = {}; res.summary = eventData.title; res.description = eventData.description || ''; res.location = eventData.location || '';
    if (eventData.isAllDay) { res.start = { date: eventData.start.split('T')[0] }; res.end = { date: eventData.end.split('T')[0] }; }
    else { res.start = { dateTime: eventData.start, timeZone: 'Asia/Tokyo' }; res.end = { dateTime: eventData.end, timeZone: 'Asia/Tokyo' }; }
    if (eventData.guests) { res.attendees = eventData.guests.split(',').map(e => e.trim()).filter(e => e).map(e => ({email:e})); }
    const c = Calendar.Events.insert(res, calendarId, { sendUpdates: 'all' });
    return JSON.stringify({ success: true, eventId: c.id, htmlLink: c.htmlLink });
  } catch(e) { throw new Error('イベント作成エラー: ' + e.toString()); }
}

function updateEvent(calendarId, eventId, eventData) {
  try {
    const ex = Calendar.Events.get(calendarId, eventId); if (!ex) throw new Error('イベントが見つかりません');
    if (eventData.title) ex.summary = eventData.title;
    if (eventData.description !== undefined) ex.description = eventData.description;
    if (eventData.location !== undefined) ex.location = eventData.location;
    if (eventData.isAllDay) { ex.start = { date: eventData.start.split('T')[0] }; ex.end = { date: eventData.end.split('T')[0] }; }
    else { ex.start = { dateTime: eventData.start, timeZone: 'Asia/Tokyo' }; ex.end = { dateTime: eventData.end, timeZone: 'Asia/Tokyo' }; }
    if (eventData.guests) { const att = ex.attendees || []; eventData.guests.split(',').map(e=>e.trim()).filter(e=>e).forEach(em => { if (!att.find(a=>a.email===em)) att.push({email:em}); }); ex.attendees = att; }
    Calendar.Events.update(ex, calendarId, eventId, { sendUpdates: 'all' });
    return JSON.stringify({ success: true });
  } catch(e) { throw new Error('更新エラー: ' + e.toString()); }
}

function deleteEvent(calendarId, eventId) {
  try { Calendar.Events.remove(calendarId, eventId, { sendUpdates: 'all' }); return JSON.stringify({ success: true }); }
  catch(e) { throw new Error('削除エラー: ' + e.toString()); }
}

// ==================== 設定管理 ====================
function saveSettings(settings) { PropertiesService.getUserProperties().setProperty('APP_SETTINGS_V2', JSON.stringify(settings)); return true; }

function loadSettings() {
  const props = PropertiesService.getUserProperties();
  const json = props.getProperty('APP_SETTINGS_V2');
  let cs = { groups: [], hiddenCalendars: [], useMonoColor: false, dividerLines: [{hour:12,label:'午後'}] };
  if (json) try { cs = JSON.parse(json); } catch(e){}
  if (!cs.hiddenCalendars) cs.hiddenCalendars = [];
  if (cs.useMonoColor === undefined) cs.useMonoColor = false;
  if (!cs.dividerLines) cs.dividerLines = [{hour:12,label:'午後'}];
  let realIds = [];
  try { realIds = CalendarApp.getAllCalendars().map(c => c.getId()); } catch(e){}
  let defGrp = (cs.groups||[]).find(g => g.id === 'default_registered');
  let members = [];
  if (defGrp && defGrp.members) {
    members = defGrp.members.filter(id => realIds.includes(id));
    const newCals = realIds.filter(id => !defGrp.members.includes(id) && !(cs.hiddenCalendars||[]).includes(id));
    members = [...members, ...newCals];
  } else { members = realIds; }
  const regGrp = { id: 'default_registered', name: (defGrp && defGrp.name) || '登録カレンダー', members, meetingView: defGrp ? !!defGrp.meetingView : false, isCompactDayView: defGrp ? !!defGrp.isCompactDayView : false };
  const customGrps = (cs.groups||[]).filter(g => g.id !== 'default_registered' && g.id !== 'default');
  const ns = { groups: [regGrp, ...customGrps], activeGroupId: cs.activeGroupId || 'default_registered', hiddenCalendars: cs.hiddenCalendars, useMonoColor: cs.useMonoColor, dividerLines: cs.dividerLines, headerPadding: cs.headerPadding||0, v1DayLayout: !!cs.v1DayLayout, teamMembers: cs.teamMembers||[] };
  if (!ns.groups.map(g=>g.id).includes(ns.activeGroupId)) ns.activeGroupId = 'default_registered';
  ns.isWorkspaceUser = checkWorkspaceStatus();
  return JSON.stringify(ns);
}

function checkWorkspaceStatus() {
  return true; // 制限撤廃のため常にtrueを返す
}

function searchDirectoryUsers(query) {
  if (!query) return JSON.stringify([]);
  const resultsMap = new Map();
  try {
    // 1. 管理者用API（最速）
    const r = AdminDirectory.Users.list({ customer: 'my_customer', query: query, maxResults: 15 });
    if (r.users) r.users.forEach(u => resultsMap.set(u.primaryEmail, { email: u.primaryEmail, name: u.name.fullName, photoUrl: u.thumbnailPhotoUrl || null }));
  } catch(e) {
    // 2. 一般ユーザー向け（People API）
    try {
      const pr = People.People.searchDirectoryPeople({ query: query, readMask: 'names,emailAddresses,photos', sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'] });
      if (pr.people) pr.people.forEach(p => {
        if (p.emailAddresses && p.emailAddresses.length > 0) {
          const email = p.emailAddresses[0].value;
          const name = (p.names && p.names.length > 0) ? p.names[0].displayName : email.split('@')[0];
          const photoUrl = (p.photos && p.photos.length > 0) ? p.photos[0].url : null;
          resultsMap.set(email, { email, name, photoUrl });
        }
      });
    } catch(e2) {}
    try {
      const cr = People.People.searchContacts({ query: query, readMask: 'names,emailAddresses,photos' });
      if (cr.results) cr.results.forEach(r => {
        const p = r.person;
        if (p && p.emailAddresses && p.emailAddresses.length > 0) {
          const email = p.emailAddresses[0].value;
          const name = (p.names && p.names.length > 0) ? p.names[0].displayName : email.split('@')[0];
          const photoUrl = (p.photos && p.photos.length > 0) ? p.photos[0].url : null;
          if (!resultsMap.has(email)) resultsMap.set(email, { email, name, photoUrl });
        }
      });
    } catch(e3) {}
  }
  return JSON.stringify(Array.from(resultsMap.values()).slice(0, 20));
}

function getUserProfiles(emails) {
  if (!emails || !Array.isArray(emails) || emails.length === 0) return JSON.stringify({});
  const map = {};
  
  // キャッシュから一括取得
  const cache = CacheService.getUserCache();
  const cachedData = cache.getAll(emails);
  const toFetch = [];
  
  emails.forEach(email => {
    if (cachedData[email]) {
      try { map[email] = JSON.parse(cachedData[email]); } catch(e) { toFetch.push(email); }
    } else {
      toFetch.push(email);
    }
  });
  
  if (toFetch.length > 0) {
    const cacheUpdates = {};
    toFetch.forEach(email => {
      let profile = null;
      try {
        const u = AdminDirectory.Users.get(email);
        if (u && u.name) profile = { name: u.name.fullName, photoUrl: u.thumbnailPhotoUrl||'' };
      } catch(e) {
        try {
          const contact = ContactsApp.getContact(email);
          if (contact && contact.getFullName()) profile = { name: contact.getFullName(), photoUrl: '' };
        } catch(e2) {}
      }
      if (profile) {
        map[email] = profile;
        cacheUpdates[email] = JSON.stringify(profile);
      }
    });
    if (Object.keys(cacheUpdates).length > 0) {
      try { cache.putAll(cacheUpdates, 21600); } catch(e) {} // 6時間キャッシュ
    }
  }
  return JSON.stringify(map);
}

function clearAllUserCache() {
  try {
    const p = PropertiesService.getUserProperties(); const all = p.getProperties();
    Object.keys(all).forEach(k => { if (k.startsWith('ST_') || k.startsWith('DIR_') || k === 'NAME_CACHE_V2') p.deleteProperty(k); });
    MEMORY_CACHE = null; SYSTEM_API_ERROR_OCCURRED = false; return true;
  } catch(e) { throw new Error('キャッシュ削除失敗: ' + e.toString()); }
}

function getSubscribedCalendars() { return JSON.stringify(CalendarApp.getAllCalendars().map(c => ({ id: c.getId(), name: c.getName(), isPrimary: c.isMyPrimaryCalendar(), color: c.getColor() }))); }
function getCurrentUserEmail() { return Session.getActiveUser().getEmail(); }
function getWebAppUrl() { return ScriptApp.getService().getUrl(); }

function getResourceCalendars() {
  const cacheKey = 'V2_RESOURCE_LIST_V5';
  const cached = CacheService.getUserCache().get(cacheKey);
  if (cached) {
    try { return cached; } catch(e){}
  }

  const resourceMap = new Map();
  try {
    // 1. 管理者用APIでの一括取得（権限チェックなし・高速）
    let pt = null;
    do {
      const opt = { maxResults: 200 }; if (pt) opt.pageToken = pt;
      const r = AdminDirectory.Resources.Calendars.list('my_customer', opt);
      if (r.items) {
        r.items.forEach(i => {
          resourceMap.set(i.resourceEmail, {
            id: i.resourceEmail, name: i.resourceName||'', email: i.resourceEmail,
            type: i.resourceType||'', capacity: i.capacity||0, isResource: true,
            description: i.resourceDescription||'', hasAccess: true
          });
        });
      }
      pt = r.nextPageToken;
    } while (pt);
  } catch(e) {}
  
  // 2. 一般ユーザー向けフォールバック（過去の予定から施設アドレスを抽出）
  if (resourceMap.size === 0) {
    try {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const events = Calendar.Events.list('primary', { timeMin: threeMonthsAgo.toISOString(), maxResults: 2500, singleEvents: true });
      if (events.items) {
        events.items.forEach(ev => {
          if (ev.attendees) {
            ev.attendees.forEach(att => {
              const email = att.email || '';
              if (email.endsWith('resource.calendar.google.com') && !resourceMap.has(email)) {
                resourceMap.set(email, {
                  id: email, email: email, name: att.displayName || email.split('@')[0],
                  type: 'extracted', capacity: 0, isResource: true, hasAccess: true
                });
              }
            });
          }
        });
      }
    } catch(e2) {}
  }
  
  const result = JSON.stringify(Array.from(resourceMap.values()));
  try { CacheService.getUserCache().put(cacheKey, result, 21600); } catch(e) {} // 6時間キャッシュ
  return result;
}

// ==================== アクティベーション ====================
function checkUserActivation() {
  if (!ENABLE_ACTIVATION_FLOW) return { isActivated: true, userEmail: 'disabled' };
  const KEY = 'ACTIVATED_USER_LIST'; let ue = '', ia = false;
  try { ue = Session.getEffectiveUser().getEmail(); const j = PropertiesService.getScriptProperties().getProperty(KEY); if (j) { const u = JSON.parse(j); if (Array.isArray(u) && u.includes(ue)) ia = true; } } catch(e){}
  return { isActivated: ia, userEmail: ue };
}
function activateUser(userEmail) {
  const KEY = 'ACTIVATED_USER_LIST'; if (!userEmail) return;
  try { const p = PropertiesService.getScriptProperties(); const j = p.getProperty(KEY); let u = j ? JSON.parse(j) : []; if (!u.includes(userEmail)) { u.push(userEmail); p.setProperty(KEY, JSON.stringify(u)); } } catch(e) { throw new Error('認証保存に失敗しました'); }
}

// ==================== クイック検索 ====================
function getQuickSchedule(email, dateStr) {
  if (!email) return JSON.stringify({ events: [], name: '', error: 'no_email' });
  loadNameCache();
  const d = dateStr ? new Date(dateStr) : new Date();
  const s = new Date(d); s.setHours(0,0,0,0);
  const e = new Date(d); e.setDate(e.getDate() + 7); e.setHours(0,0,0,0);
  const calData = fetchCalendarEventsREST(email, s.toISOString(), e.toISOString(), true);
  const pi = resolvePersonInfo(email, calData.calendarName || '', false);
  saveNameCache();
  return JSON.stringify({
    email: email,
    name: pi.name || email.split('@')[0],
    photoUrl: pi.photoUrl || '',
    color: calData.calendarColor || '#4285F4',
    events: (calData.events || []).filter(ev => !ev.deleted).sort((a,b) => new Date(a.start) - new Date(b.start)),
    error: calData.error || null
  });
}

// ==================== チームステータス ====================
function getTeamStatus(emails) {
  if (!emails || !Array.isArray(emails) || emails.length === 0) return JSON.stringify([]);
  loadNameCache();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const todayEnd = new Date(now); todayEnd.setDate(todayEnd.getDate() + 1); todayEnd.setHours(0,0,0,0);
  
  const results = emails.map(email => {
    const calData = fetchCalendarEventsREST(email, todayStart.toISOString(), todayEnd.toISOString(), true);
    const pi = resolvePersonInfo(email, calData.calendarName || '', false);
    
    // 終日予定を抽出
    const allDayEvents = (calData.events || []).filter(ev => !ev.deleted && ev.isAllDay)
      .map(ev => ({ title: ev.title || '予定あり' }));
      
    // 時間指定の予定を抽出
    const events = (calData.events || []).filter(ev => !ev.deleted && !ev.isAllDay)
      .sort((a,b) => new Date(a.start) - new Date(b.start));
    
    let current = null, next = null;
    const nowMs = now.getTime();
    
    for (const ev of events) {
      const eStart = new Date(ev.start).getTime();
      const eEnd = new Date(ev.end).getTime();
      if (eStart <= nowMs && eEnd > nowMs) {
        current = { title: ev.title || '予定あり', start: ev.start, end: ev.end };
      } else if (eStart > nowMs && !next) {
        next = { title: ev.title || '予定あり', start: ev.start, end: ev.end };
      }
    }
    
    return {
      email: email,
      name: pi.name || email.split('@')[0],
      photoUrl: pi.photoUrl || '',
      current: current,
      next: next,
      allDayEvents: allDayEvents,
      isFree: !current
    };
  });
  
  saveNameCache();
  return JSON.stringify(results);
}
function clearServerCache() {
  const c = CacheService.getUserCache();
  if(c) c.removeAll(['recent_searches']); // Note: User cache keys vary, but we can't delete all keys without knowing them unless we loop, but CacheService doesn't allow listing keys.
  // Actually, we can clear the memory cache in the script
  MEMORY_CACHE = {};
  return true;
}

function factoryReset() {
  const p = PropertiesService.getUserProperties();
  p.deleteProperty('APP_SETTINGS_V2');
  p.deleteProperty('NAME_CACHE_V2');
  p.deleteProperty('APP_SETTINGS'); // V1 data cleanup
  p.deleteProperty('NAME_CACHE'); // V1 data cleanup
  return true;
}
