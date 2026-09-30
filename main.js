// ==========================================
// 0. Vercel 환경 변수 및 파이어베이스 설정
// ==========================================
const envApiKey = (
    import.meta.env.VITE_PNU_PA_LOVE || 
    import.meta.env.VITE_GEMINI_API_KEY || 
    import.meta.env.pnu_pa_love || 
    ""
).trim();

const firebaseConfig = {
    apiKey: "AIzaSyDvaUqcZr8t9p3xBZWRk0rTbxjjQz_u-Do",
    authDomain: "pa-love-doch107905.firebaseapp.com",
    projectId: "pa-love-doch107905",
    storageBucket: "pa-love-doch107905.firebasestorage.app",
    messagingSenderId: "1060619460349",
    appId: "1:1060619460349:web:900630f86f8663839f2894",
    measurementId: "G-J8T2WH0BG4",
    databaseURL: "https://pa-love-doch107905-default-rtdb.asia-southeast1.firebasedatabase.app"
};

let db = null;
function getFirebaseDb() {
    if (!db) {
        try {
            if (typeof firebase !== 'undefined') {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                db = firebase.database();
            }
        } catch (e) {
            console.error("Firebase DB 연결 실패:", e);
        }
    }
    return db;
}

function saveToLocalStorage(data) {
    try {
        let registrations = JSON.parse(localStorage.getItem('yeonbun_registrations') || '[]');
        let idx = registrations.findIndex(p => 
            (data._fbKey && p._fbKey === data._fbKey) ||
            (p.insta && data.insta && p.insta === data.insta && p.insta !== '-') || 
            (p.name === data.name && p.birth === data.birth)
        );
        if (idx !== -1) {
            registrations[idx] = { ...registrations[idx], ...data };
        } else {
            registrations.push(data);
        }
        localStorage.setItem('yeonbun_registrations', JSON.stringify(registrations));
    } catch (e) {
        console.error("LocalStorage 저장 오류:", e);
    }
}

async function fetchAllRegistrations() {
    let list = [];
    const activeDb = getFirebaseDb();
    if (activeDb) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("DB Timeout")), 2500)
            );
            const dbPromise = activeDb.ref('registrations').once('value');
            const snapshot = await Promise.race([dbPromise, timeoutPromise]);
            const val = snapshot.val();

            if (val) {
                list = Object.keys(val).map(key => ({ _fbKey: key, ...val[key] }));
            }
        } catch (e) {
            console.warn("Firebase 읽기 지연/실패 -> 로컬 데이터 활용:", e);
        }
    }
    if (list.length === 0) {
        list = JSON.parse(localStorage.getItem('yeonbun_registrations') || '[]');
    }

    const map = new Map();
    list.forEach(item => {
        if (!item.name || !item.birth) return;
        const id = (item.insta && item.insta !== '-') ? item.insta : (item.name.trim() + '_' + item.birth.trim());
        if (!map.has(id)) {
            map.set(id, item);
        } else {
            const existing = map.get(id);
            if ((!existing.chosenBox || existing.chosenBox === '미선택') && item.chosenBox && item.chosenBox !== '미선택') {
                map.set(id, item);
            } else if (!existing.matchedPartner && item.matchedPartner) {
                map.set(id, item);
            }
        }
    });

    return Array.from(map.values());
}

async function saveRegistration(data) {
    const sanitizedData = JSON.parse(JSON.stringify(data));
    saveToLocalStorage(sanitizedData);
    
    const activeDb = getFirebaseDb();
    if (activeDb) {
        try {
            let targetKey = data._fbKey || userState._fbKey;

            if (!targetKey) {
                const snapshot = await activeDb.ref('registrations').once('value');
                const val = snapshot.val() || {};
                for (let key in val) {
                    if ((val[key].insta && sanitizedData.insta && val[key].insta === sanitizedData.insta && sanitizedData.insta !== '-') || 
                        (val[key].name === sanitizedData.name && val[key].birth === sanitizedData.birth)) {
                        targetKey = key;
                        break;
                    }
                }
            }

            if (targetKey) {
                sanitizedData._fbKey = targetKey;
                userState._fbKey = targetKey;
                await activeDb.ref('registrations/' + targetKey).update(sanitizedData);
            } else {
                const newRef = activeDb.ref('registrations').push();
                sanitizedData._fbKey = newRef.key;
                userState._fbKey = newRef.key;
                await newRef.set(sanitizedData);
            }
        } catch (e) {
            console.error("Firebase 저장/갱신 에러:", e);
        }
    }
}

// ==========================================
// 1. 전역 상태 및 화면 전환
// ==========================================
let userState = {
    _fbKey: "",
    birth: "",
    dayGan: "",
    dayZhi: "",
    element: "",
    name: "",
    gender: "",
    birthTime: "",
    calendarType: "",
    birthRegion: "",
    age: "",
    dept: "",
    insta: "",
    emoji: "",
    intro: "",
    chosenBox: "",
    matchedPartner: null,
    matchScore: 0
};

let offlineTargetUser = null; 
let stepHistory = [];

function showStep(stepId, isBack = false) {
    const activeEl = document.querySelector('.step.active');
    
    if (!isBack && activeEl && activeEl.id !== stepId) {
        stepHistory.push(activeEl.id);
    }

    document.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active');
    });
    
    const targetScreen = document.getElementById(stepId);
    if (targetScreen) {
        targetScreen.classList.add('active');
        window.scrollTo(0, 0);
    } else {
        console.error("화면을 찾을 수 없습니다: " + stepId);
    }
}

function goBack() {
    if (stepHistory.length > 0) {
        const prevStep = stepHistory.pop();
        showStep(prevStep, true);
    } else {
        showStep('step1', true);
    }
}

function goHome() {
    stepHistory = [];
    showStep('step1', true);
}

function goToOfflineTargetSearch(source) {
    const cardArea = document.getElementById('offTargetCardArea');
    if (cardArea) {
        cardArea.style.display = 'none';
        cardArea.innerHTML = '';
    }
    showStep('step_offline_target');
}

// ==========================================
// 2. 만세력 및 사주명리 엔진
// ==========================================
function getPureDayPillar(y, m, d) {
    const refUtc = Date.UTC(2000, 0, 1);
    const targetUtc = Date.UTC(y, m - 1, d);
    const diffDays = Math.round((targetUtc - refUtc) / 86400000);
    
    let ganIdx = (4 + diffDays) % 10;
    if (ganIdx < 0) ganIdx = (ganIdx % 10 + 10) % 10;
    
    let zhiIdx = (6 + diffDays) % 12;
    if (zhiIdx < 0) zhiIdx = (zhiIdx % 12 + 12) % 12;

    const gans = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const zhis = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

    return { dayGan: gans[ganIdx], dayZhi: zhis[zhiIdx] };
}

function getSajuDetailFromBirth(inputVal) {
    if (!inputVal || inputVal.length !== 6) return { element: "목(木)", ganName: "갑목(甲木)", dayGan: "甲", dayZhi: "寅", desc: "기본 기운입니다." };

    let yy = parseInt(inputVal.substring(0, 2), 10);
    let mm = parseInt(inputVal.substring(2, 4), 10);
    let dd = parseInt(inputVal.substring(4, 6), 10);

    if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return { element: "목(木)", ganName: "갑목(甲木)", dayGan: "甲", dayZhi: "寅", desc: "기본 기운입니다." };

    let fullYear = (yy <= 35) ? (2000 + yy) : (1900 + yy);
    let pillar = { dayGan: "甲", dayZhi: "寅" };

    try {
        if (typeof Solar !== "undefined" && typeof Solar.fromYmdHms === "function") {
            const solar = Solar.fromYmdHms(fullYear, mm, dd, 12, 0, 0);
            const eightChar = solar.getLunar().getEightChar();
            pillar.dayGan = eightChar.getDayGan();
            pillar.dayZhi = eightChar.getDayZhi();
        } else {
            pillar = getPureDayPillar(fullYear, mm, dd);
        }
    } catch (e) {
        pillar = getPureDayPillar(fullYear, mm, dd);
    }

    const ganOhaengMap = {
        '甲': { element: '목(木)', ganName: '갑목(甲木)', desc: '큰 나무처럼 곧고 당당하며 강한 주관을 가진 甲木(갑목)의 기운입니다.' },
        '乙': { element: '목(木)', ganName: '을목(乙木)', desc: '유연하고 끈기 있으며 어울림이 뛰어난 乙木(을목)의 기운입니다.' },
        '丙': { element: '화(火)', ganName: '병화(丙火)', desc: '태양처럼 밝고 열정적이며 다정한 丙火(병화)의 기운입니다.' },
        '丁': { element: '화(火)', ganName: '정화(丁火)', desc: '촛불처럼 온화하고 섬세하며 따뜻한 丁火(정화)의 기운입니다.' },
        '戊': { element: '토(土)', ganName: '무토(戊土)', desc: '너른 산과 대지처럼 포용력 있고 든든한 戊土(무토)의 기운입니다.' },
        '己': { element: '토(土)', ganName: '기토(己土)', desc: '비옥한 흙처럼 자상하고 신중한 己土(기토)의 기운입니다.' },
        '庚': { element: '금(金)', ganName: '경금(庚金)', desc: '강인한 쇠/바위처럼 결단력 있고 의리 넘치는 庚金(경금)의 기운입니다.' },
        '辛': { element: '금(金)', ganName: '신금(辛金)', desc: '보석처럼 정교하고 섬세한 감각을 지닌 辛金(신금)의 기운입니다.' },
        '壬': { element: '수(水)', ganName: '임수(壬水)', desc: '넓은 바다처럼 지혜롭고 분위기를 잘 맞추는 壬水(임수)의 기운입니다.' },
        '癸': { element: '수(水)', ganName: '계수(癸水)', desc: '단비처럼 촉촉하고 감성적인 癸水(계수)의 기운입니다.' }
    };

    const info = ganOhaengMap[pillar.dayGan] || { element: "목(木)", ganName: "갑목(甲木)", desc: "나무의 기운입니다." };
    return {
        element: info.element,
        ganName: info.ganName,
        dayGan: pillar.dayGan,
        dayZhi: pillar.dayZhi,
        desc: info.desc
    };
}

function calculateElement() {
    const birthEl = document.getElementById('birthInput');
    const inputVal = birthEl ? birthEl.value.trim() : "";
    if (inputVal.length !== 6) {
        alert('생년월일 6자리(YYMMDD)를 정확히 입력해주소서!');
        return;
    }

    let yy = parseInt(inputVal.substring(0, 2), 10);
    let mm = parseInt(inputVal.substring(2, 4), 10);
    let dd = parseInt(inputVal.substring(4, 6), 10);

    if (isNaN(yy) || isNaN(mm) || isNaN(dd) || mm < 1 || mm > 12) {
        alert('올바른 생년월일 숫자를 입력해주소서!');
        return;
    }

    let fullYear = (yy <= 35) ? (2000 + yy) : (1900 + yy);

    const dateObj = new Date(fullYear, mm - 1, dd);
    if (dateObj.getFullYear() !== fullYear || dateObj.getMonth() !== (mm - 1) || dateObj.getDate() !== dd) {
        alert('존재하지 않는 날짜이옵니다. 생년월일을 다시 확인해주소서!');
        return;
    }

    userState.birth = inputVal;

    const resultInfo = getSajuDetailFromBirth(inputVal);

    userState.dayGan = resultInfo.dayGan;
    userState.dayZhi = resultInfo.dayZhi;
    userState.element = resultInfo.element;

    const resEl = document.getElementById('elementResultText');
    if (resEl) {
        resEl.innerHTML = `
            <b>[ 정통 사주 명리학 감정 결과 ]</b><br><br>
            생년월일: <b>${fullYear}년 ${mm}월 ${dd}일</b><br>
            사주 일주 천간: <b>${resultInfo.ganName}</b> (${resultInfo.dayGan}${resultInfo.dayZhi})<br>
            본원 오행: <b>${resultInfo.element}</b><br><br>
            ${resultInfo.desc}
        `;
    }

    const todayBirthEl = document.getElementById('todayBirthDisplay');
    if (todayBirthEl) todayBirthEl.value = inputVal;

    const matchBirthEl = document.getElementById('matchBirthDisplay');
    if (matchBirthEl) matchBirthEl.value = inputVal;

    showStep('step2_result');
}

function getLovePrompt(u) {
    return `
* 이름 : ${u.name}
* 생년월일 : ${u.birth}
* 태어난 시간 : ${u.birthTime}
* 양력/음력 : ${u.calendarType}
* 성별 : ${u.gender}
* 출생 지역 : ${u.birthRegion}

너는 30년 이상 경력을 가진 사주명리학 전문가야. 사주 구조와 오행의 흐름을 종합적으로 분석해서 현실적이고 구체적으로 설명해 줘. 사주를 통한 소개팅 부스에서 사용할 거야. 나를 표현하는 오행 하나와 나에게 부족하거나 나와 사주적으로 잘 어울리는 상대방의 오행을 알려줘. 간략하게 작성하고 강조해줘. 우리가 손님 한명한명한테 읽어줘야하기때문에 회전률을 고려해줘. 
정보를 줄게. 이걸 바탕으로 올해 연애운을 분석해줘. 말투는 사주명리학 전문가처럼 해줘.

- 3년 이내에 새로운 인연이 들어오는 가장 강력한 시기를 알려줘. 
- 나의 연애 스타일을 분석해줘.
- 2026년 하반기 연애운을 높이기 위해 지금부터 실천하면 좋을 행동 5가지를 추천해줘.
- 나에게 좋은 연애 기운과 인연을 당겨다 줄 행운의 아이템을 분석 및 추천해줘.
- 연애운 분석결과에 대해 자세히 설명해줘.

* 태어난 시간을 모르면 시주를 제외해 분석해줘.
`;
}

function getTodayPrompt(u) {
    return `
* 이름 : ${u.name}
* 생년월일 : ${u.birth}
* 태어난 시간 : ${u.birthTime}
* 양력/음력 : ${u.calendarType}
* 성별 : ${u.gender}
* 출생 지역 : ${u.birthRegion}

너는 30년 이상 경력을 가진 사주명리학 전문가야. 사주 구조와 오행의 흐름을 종합적으로 분석해서 현실적이고 구체적으로 설명해 줘. 사주를 통한 축제 부스에서 사용할 거야. 간략하게 작성하고 강조해줘. 우리가 손님 한명한명한테 읽어줘야하기때문에 회전률을 고려해줘. 
정보를 줄게. 이걸 바탕으로 오늘(2026년 10월 1일)의 운세를 분석해줘. 말투는 사주명리학 전문가처럼 해줘.

- 행운의 컬러와 행운의 숫자를 분석해줘.
- 오늘의 행운의 아이템을 추천해줘.
- 오늘의 운세 총운, 재물운, 학업운, 연애운, 인간관계운을 알려줘.
- 오늘 하면 좋은 행동, 피하면 좋은 행동을 알려줘
- 오늘의 한줄 조언을 알려줘.

* 태어난 시간을 모르면 시주를 제외해 분석해줘.
`;
}

// ==========================================
// 3. API 전처리, Exponential Backoff 및 Fallback 구현
// ==========================================

function sanitizePromptText(text) {
    if (!text) return "";
    return text
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

async function fetchGeminiWithBackoff(promptText, apiKey, modelName = "gemini-flash-lite-latest", maxRetries = 2) {
    const cleanPrompt = sanitizePromptText(promptText);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    let delay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: cleanPrompt }] }]
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) return text;
            }

            if ([503, 429, 500].includes(response.status) && attempt < maxRetries) {
                console.warn(`[${modelName}] HTTP ${response.status} 발생. ${delay}ms 대기 후 재시도 (${attempt}/${maxRetries})...`);
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            }

            console.warn(`[${modelName}] API 응답 실패 (Status: ${response.status})`);
            break;
        } catch (e) {
            console.warn(`[${modelName}] 네트워크 에러 발생 (${attempt}/${maxRetries}):`, e);
            if (attempt < maxRetries) {
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
            }
        }
    }
    return null;
}

async function callGeminiSafe(promptText, apiKey) {
    if (!apiKey) return null;
    
    let result = await fetchGeminiWithBackoff(promptText, apiKey, "gemini-flash-lite-latest", 2);
    
    if (!result) {
        console.warn("메인 모델(gemini-flash-lite-latest) 호출 실패 -> 경량 Fallback 모델(gemini-2.5-flash-lite)로 전환 중...");
        result = await fetchGeminiWithBackoff(promptText, apiKey, "gemini-2.5-flash-lite", 2);
    }
    
    return result;
}

async function processTodayFortuneAI() {
    const name = document.getElementById('todayName')?.value?.trim() || "익명참가자";
    const gender = document.getElementById('todayGender')?.value || "";
    const calendarType = document.getElementById('todayCalendarType')?.value || "양력";
    const birthTime = document.getElementById('todayBirthTime')?.value || "모름";
    const birthRegion = document.getElementById('todayBirthRegion')?.value?.trim() || "미지정";

    if (!gender) {
        alert("성별을 선택해주소서!");
        return;
    }

    userState.name = name;
    userState.gender = gender;
    userState.calendarType = calendarType;
    userState.birthTime = birthTime;
    userState.birthRegion = birthRegion;

    const todayBirthVal = document.getElementById('todayBirthDisplay')?.value?.trim();
    if (todayBirthVal) userState.birth = todayBirthVal;

    if ((!userState.element || !userState.dayGan) && userState.birth) {
        const sajuDetail = getSajuDetailFromBirth(userState.birth);
        userState.element = sajuDetail.element;
        userState.dayGan = sajuDetail.dayGan;
        userState.dayZhi = sajuDetail.dayZhi;
    }

    showStep('step_today_result');
    const loadingEl = document.getElementById('todayLoading');
    const boxEl = document.getElementById('todayResultBox');
    if (loadingEl) loadingEl.style.display = 'block';
    if (boxEl) boxEl.style.display = 'none';

    const apiKey = (localStorage.getItem('gemini_api_key') || envApiKey).trim();
    let resultText = "";

    if (apiKey) {
        resultText = await callGeminiSafe(getTodayPrompt(userState), apiKey);
    }

    if (!resultText) {
        resultText = generateDynamicTodayFortune(userState.name, userState.birth, userState.gender, userState.dayGan, userState.element);
    } else {
        resultText = formatMarkdown(resultText);
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (boxEl) {
        boxEl.style.display = 'block';
        boxEl.innerHTML = `<b>[ 🔮 2026년 10월 1일 오늘의 운세 상세 감정 ]</b><br><br>${resultText}`;
    }
}

async function processMatchAI() {
    userState.name = document.getElementById('userName')?.value?.trim() || "익명참가자";
    userState.gender = document.getElementById('userGender')?.value || "";

    if (!userState.gender) {
        alert("성별을 선택해주소서!");
        return;
    }

    const matchBirthVal = document.getElementById('matchBirthDisplay')?.value?.trim();
    if (matchBirthVal) userState.birth = matchBirthVal;

    if ((!userState.element || !userState.dayGan) && userState.birth) {
        const sajuDetail = getSajuDetailFromBirth(userState.birth);
        userState.element = sajuDetail.element;
        userState.dayGan = sajuDetail.dayGan;
        userState.dayZhi = sajuDetail.dayZhi;
    }

    userState.calendarType = document.getElementById('userCalendarType')?.value || "양력";
    userState.birthTime = document.getElementById('userBirthTime')?.value || "모름";
    userState.birthRegion = document.getElementById('userBirthRegion')?.value?.trim() || "미지정";
    userState.age = document.getElementById('userAge')?.value?.trim() || "-";
    userState.dept = document.getElementById('userDept')?.value?.trim() || "-";
    userState.insta = document.getElementById('userInsta')?.value?.trim() || "-";
    userState.emoji = document.getElementById('userEmoji')?.value?.trim() || "";
    userState.intro = document.getElementById('userIntro')?.value?.trim() || "좋은 인연 만나요!";
    if (!userState.chosenBox) userState.chosenBox = "미선택";

    showStep('step_match_ai');
    const loadingEl = document.getElementById('matchAiLoading');
    const containerEl = document.getElementById('matchAiResultContainer');
    if (loadingEl) loadingEl.style.display = 'block';
    if (containerEl) containerEl.style.display = 'none';

    saveRegistration(userState);

    const apiKey = (localStorage.getItem('gemini_api_key') || envApiKey).trim();

    let loveText = "";
    let todayText = "";

    if (apiKey) {
        loveText = await callGeminiSafe(getLovePrompt(userState), apiKey);
        await new Promise(res => setTimeout(res, 1000));
        todayText = await callGeminiSafe(getTodayPrompt(userState), apiKey);
    }

    if (!loveText) {
        loveText = generateDynamicLoveFortune(userState.name, userState.birth, userState.gender, userState.dayGan, userState.element);
    } else {
        loveText = formatMarkdown(loveText);
    }

    if (!todayText) {
        todayText = generateDynamicTodayFortune(userState.name, userState.birth, userState.gender, userState.dayGan, userState.element);
    } else {
        todayText = formatMarkdown(todayText);
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (containerEl) containerEl.style.display = 'block';

    const loveEl = document.getElementById('aiLoveResult');
    const todayEl = document.getElementById('aiTodayResult');
    if (loveEl) loveEl.innerHTML = `<b>[ 💘 2026년 연애운 분석 ]</b><br><br>${loveText}`;
    if (todayEl) todayEl.innerHTML = `<b>[ 🔮 오늘의 운세 (2026년 10월 1일) ]</b><br><br>${todayText}`;
}

function formatMarkdown(text) {
    if (!text) return "";
    return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}

function saveApiKey() {
    const inputEl = document.getElementById('geminiApiKeyInput');
    const key = inputEl ? inputEl.value.trim() : "";
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        alert("Gemini API Key가 안전하게 저장되었습니다!");
    } else {
        alert("API Key를 입력해주소서!");
    }
}

// ==========================================
// 4. 오행 상자 선택 및 매칭 로직
// ==========================================
async function openBoxList(boxName) {
    userState.chosenBox = boxName;
    
    await saveRegistration(userState);

    let registrations = await fetchAllRegistrations();
    
    let availablePartners = registrations.filter(p => {
        const isSelf = (p._fbKey && userState._fbKey && p._fbKey === userState._fbKey) || 
                       (p.insta && userState.insta && p.insta === userState.insta && p.insta !== '-') || 
                       (p.name === userState.name && p.birth === userState.birth);
        const matchesBox = p.element === boxName || (p.element && boxName && p.element.includes(boxName.charAt(0)));
        
        const userG = (userState.gender || '남').charAt(0);
        const targetG = (p.gender || '여').charAt(0);
        const isOppositeGender = (userG === '남' && targetG === '여') || (userG === '여' && targetG === '남');

        return !isSelf && matchesBox && isOppositeGender;
    });

    const container = document.getElementById('partnerListContainer');
    const actionBtnContainer = document.getElementById('boxListActionButtons');

    if (availablePartners.length === 0) {
        const titleEl = document.getElementById('boxListTitle');
        if (titleEl) titleEl.innerText = `${boxName} 상자`;
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; color: #5a3e36; font-weight: bold; padding: 30px 10px; font-size: 15px; line-height: 1.6;">
                    상자에 아직 충분한 인연이 있지 않습니다.
                </div>
            `;
        }
        if (actionBtnContainer) {
            actionBtnContainer.innerHTML = `
                <button style="background-color: #5a3e36; margin-top: 15px;" onclick="saveAndReset()">📜 데이터 저장하고 초기화면 돌아가기</button>
                <button style="background-color: #8c6d62; margin-top: 5px;" onclick="showStep('step5')">다른 상자 고르기</button>
            `;
        }
        showStep('step5_list');
    } else {
        const randomIndex = Math.floor(Math.random() * availablePartners.length);
        const selectedPartner = availablePartners[randomIndex];
        selectThisPartner(selectedPartner);
    }
}

async function saveAndReset() {
    await saveRegistration(userState);
    alert("작성하신 인연 정보가 클라우드 대장에 접수되었습니다. 인연을 기다리는 마음으로 초기 화면으로 이동합니다.");
    location.reload();
}

function selectThisPartner(partnerObj) {
    userState.matchedPartner = partnerObj;
    saveRegistration(userState);

    renderMatchResult();
    showStep('step6');
}

function calculateSajuMatchEngine(userA, userB) {
    const detailA = getSajuDetailFromBirth(userA.birth);
    const detailB = getSajuDetailFromBirth(userB.birth);

    const ganA = detailA.dayGan;
    const ganB = detailB.dayGan;
    const zhiA = detailA.dayZhi;
    const zhiB = detailB.dayZhi;

    const stemCombo = [ganA, ganB].sort().join('');
    const isStemHe = ['甲己', '乙庚', '丙辛', '丁壬', '戊癸'].includes(stemCombo);

    const zhiCombo = [zhiA, zhiB].sort().join('');
    const isBranchHe = ['丑子', '亥寅', '卯戌', '辰酉', '巳申', '午未'].includes(zhiCombo);

    const elemA = detailA.element.charAt(0);
    const elemB = detailB.element.charAt(0);

    const sangsaengMap = { '목': '화', '화': '토', '토': '금', '금': '수', '수': '목' };

    let baseScore = 78;
    let relationTitle = "";
    let explanation1 = "";
    let paragraph2 = "";

    if (isStemHe) {
        baseScore += 16;
        relationTitle = "천간명합(天干明合) - 하늘이 점지한 천생연분";
        explanation1 = `<b>${userA.name}</b> 님의 <b>${detailA.ganName}</b>와 <b>${userB.name}</b> 님의 <b>${detailB.ganName}</b>가 천간합(天干合)을 이루어, 명리학적으로 성격과 영혼이 깊게 조화를 이루는 최고의 천생연분입니다. 서로를 기분 좋게 끌어당기는 끌림이 대단히 강합니다.`;
    } else if (isBranchHe) {
        baseScore += 14;
        relationTitle = "지지육합(地支六合) - 삶의 안식처가 되는 정연";
        explanation1 = `<b>${userA.name}</b> 님(${detailA.dayGan}${detailA.dayZhi})과 <b>${userB.name}</b> 님(${detailB.dayGan}${detailB.dayZhi})은 일지(日支) 가 육합(六合)을 이루어 현실 생활 패턴과 감정선이 매우 유기적으로 일치하는 기운입니다.`;
    } else if (elemA === elemB) {
        baseScore += 10;
        relationTitle = "비화(比和) - 마음이 통하는 평행선";
        explanation1 = `<b>${userA.name}</b> 님과 <b>${userB.name}</b> 님은 둘 다 동일한 <b>${detailA.element}</b> 기운을 가져 서로의 기분과 동선을 직관적으로 이해할 수 있는 편안한 관계입니다.`;
    } else if (sangsaengMap[elemA] === elemB || sangsaengMap[elemB] === elemA) {
        baseScore += 12;
        relationTitle = "상생(相生) - 서로를 활짝 꽃피우는 길연";
        explanation1 = `<b>${userA.name}</b> 님의 ${detailA.element} 기운과 <b>${userB.name}</b> 님의 ${detailB.element} 기운이 서로를 살려주는 상생(相生)의 흐름으로, 함께할수록 시너지가 폭발하는 선순환 궁합입니다.`;
    } else {
        baseScore += 6;
        relationTitle = "상극(相克) - 강렬하게 사로잡히는 묘연";
        explanation1 = `<b>${userA.name}</b> 님과 <b>${userB.name}</b> 님의 오행은 상반되어 서로 자극을 주는 '상극(相克)'의 관계입니다. 나에게 없는 완벽히 새로운 매력에 강하게 끌리는 묘연의 특성을 지닙니다.`;
    }

    let hash = 0;
    const str = userA.name + userA.birth + userB.name + userB.birth;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    const finalScore = Math.min(99, Math.max(72, baseScore + (Math.abs(hash) % 7)));

    paragraph2 = `두 사람의 사주 일주(${detailA.dayGan}${detailA.dayZhi} ↔ ${detailB.dayGan}${detailB.dayZhi})는 오행의 밸런스를 매끄럽게 보완해주고 있으므로, 진솔하게 마음을 나누며 인스타그램 계정이나 오프라인 대화를 시작하시면 깊은 신뢰와 호감을 가꾸어 갈 것입니다.`;

    return {
        score: finalScore,
        title: relationTitle,
        exp1: explanation1,
        exp2: paragraph2
    };
}

function renderMatchResult() {
    const p = userState.matchedPartner;
    if (!p) return;

    let fullName = p.name || "익명참가자";

    const profileEl = document.getElementById('partnerProfileArea');
    if (profileEl) {
        profileEl.innerHTML = `
            <div class="partner-profile-card">
                <h3>${p.emoji ? p.emoji + ' ' : ''}${fullName} 님의 인연등록서</h3>
                <b>• 나이:</b> ${p.age}세<br>
                <b>• 학과:</b> ${p.dept}<br>
                <b>• 사주 오행:</b> ${p.element || '오행미정'}<br>
                <b>• 인스타그램:</b> <code>${p.insta}</code><br>
                <b>• 하고싶은 말:</b> "${p.intro || '잘 부탁드립니다!'}"
            </div>
        `;
    }

    const res = calculateSajuMatchEngine(userState, p);

    const matchEl = document.getElementById('matchResultText');
    if (matchEl) {
        matchEl.innerHTML = `
            <b>[ 📜 연분청 사주 궁합 결과지 ]</b><br><br>
            궁합 진단: <b>[ ${res.score}점 / ${res.title} ]</b><br><br>
            ${res.exp1}<br><br>
            ${res.exp2}
        `;
    }
}

// ==========================================
// 5. 관리자 기능 및 오프라인 궁합 기능
// ==========================================
async function adminGrantMatchRight() {
    const code = prompt("운영진 인증코드를 입력하소서:");
    if (code === "7693") {
        const searchName = prompt("조회할 참가자의 성함을 입력하소서:");
        if (!searchName || !searchName.trim()) {
            alert("인연등록서에 접수되지 않은 인원이옵니다. 성함과 생년월일을 다시금 확인해주소서!");
            return;
        }
        const searchBirth = prompt("조회할 참가자의 생년월일 6자리(YYMMDD)를 입력하소서:");
        if (!searchBirth || !searchBirth.trim()) {
            alert("인연등록서에 접수되지 않은 인원이옵니다. 성함과 생년월일을 다시금 확인해주소서!");
            return;
        }

        let registrations = await fetchAllRegistrations();
        const foundUser = registrations.find(p => p.name && p.birth && p.name.trim().replace(/\s+/g, '') === searchName.trim().replace(/\s+/g, '') && p.birth.trim() === searchBirth.trim());

        if (foundUser) {
            userState = { ...foundUser };
            alert(`[${foundUser.name}] 님의 데이터를 확인했습니다! 오행과 궁합 설명 창으로 이동합니다.`);
            showStep('step4');
        } else {
            alert("인연등록서에 접수되지 않은 인원이옵니다. 성함과 생년월일을 다시금 확인해주소서!");
        }
    } else if (code !== null) {
        alert("인증코드가 틀렸습니다!");
    }
}

function goToBoxSelection() {
    const code = prompt("운영진 인증코드를 입력하소서:");
    if (code === "7693") {
        alert("다른 상자를 고르기 위해 오행 상자 선택 창으로 이동합니다!");
        showStep('step5');
    } else if (code !== null) {
        alert("인증코드가 틀렸습니다!");
    }
}

function requestAdminCode() {
    const code = prompt("관리자 인증코드를 입력하소서:");
    if (code === "7693") {
        const key = localStorage.getItem('gemini_api_key') || envApiKey;
        const inputEl = document.getElementById('geminiApiKeyInput');
        if (inputEl) inputEl.value = key;
        renderAdminData();
        showStep('step7');
    } else if (code !== null) {
        alert("인증코드가 틀렸습니다!");
    }
}

async function renderAdminData() {
    const container = document.getElementById('adminDataContainer');
    if (!container) return;

    const registrations = await fetchAllRegistrations();

    const categories = ["목(木)", "화(火)", "토(土)", "금(金)", "수(水)"];
    let html = "";

    categories.forEach(cat => {
        const filtered = registrations.filter(item => item.element === cat || (item.element && item.element.includes(cat.charAt(0))));
        html += `
            <div class="element-category">
                <h4>${cat} 기운 (${filtered.length}명)</h4>
        `;

        if (filtered.length === 0) {
            html += `<div class="data-item" style="color:#888; justify-content:center;">등록된 인원이 없사옵니다.</div>`;
        } else {
            filtered.forEach(p => {
                let key = p._fbKey || p.insta || p.name;
                let matchInfo = p.matchedPartner ? `${p.matchedPartner.name}` : "매칭 대기중";
                let genderLabel = p.gender ? `[${p.gender}]` : "";
                html += `
                    <div class="data-item">
                        <div>
                            <b>${p.emoji ? p.emoji + ' ' : ''}${p.name}</b> ${genderLabel} (${p.age}세, ${p.dept})<br>
                            🕒 ${p.birthTime || '시간모름'} | 📍 ${p.birthRegion || '-'}<br>
                            📱 ${p.insta} | 💬 ${p.intro || '-'}<br>
                            🎁 선택상자: ${p.chosenBox || '미선택'} | 💞 매칭상대: ${matchInfo}
                        </div>
                        <button class="delete-btn" onclick="deleteData('${key}')">삭제</button>
                    </div>
                `;
            });
        }
        html += `</div>`;
    });

    container.innerHTML = html;
}

async function deleteData(key) {
    if (confirm("해당 인연 기록을 대장에서 삭제하시겠습니까?")) {
        const activeDb = getFirebaseDb();
        if (activeDb && key && key.length > 5) {
            try {
                await activeDb.ref('registrations/' + key).remove();
            } catch (e) {
                console.error("Firebase 삭제 실패:", e);
            }
        }
        let registrations = JSON.parse(localStorage.getItem('yeonbun_registrations') || '[]');
        registrations = registrations.filter(p => p._fbKey !== key && p.insta !== key && p.name !== key);
        localStorage.setItem('yeonbun_registrations', JSON.stringify(registrations));
        
        await renderAdminData();
    }
}

async function searchOfflineTarget() {
    const nameInput = document.getElementById('offTargetName');
    const birthInput = document.getElementById('offTargetBirth');
    const name = nameInput ? nameInput.value.trim() : "";
    const birth = birthInput ? birthInput.value.trim() : "";

    if (!name || !birth || birth.length !== 6) {
        alert("상대방 성함과 생년월일 6자리를 꼭 입력해주소서!");
        return;
    }

    let registrations = await fetchAllRegistrations();
    let found = registrations.find(p => 
        p.name && p.birth && 
        p.name.trim().replace(/\s+/g, '') === name.replace(/\s+/g, '') && 
        p.birth.trim() === birth
    );

    if (!found) {
        alert("인연등록서에 접수되지 않은 인원이옵니다. 성함과 생년월일을 다시금 확인해주소서!");
        const cardArea = document.getElementById('offTargetCardArea');
        if (cardArea) cardArea.style.display = 'none';
        return;
    }

    const gender = document.getElementById('offTargetGender')?.value;
    const calendarType = document.getElementById('offTargetCalendarType')?.value;
    const birthTime = document.getElementById('offTargetBirthTime')?.value;
    const birthRegion = document.getElementById('offTargetBirthRegion')?.value?.trim();

    if (gender) found.gender = gender;
    if (calendarType) found.calendarType = calendarType;
    if (birthTime) found.birthTime = birthTime;
    if (birthRegion) found.birthRegion = birthRegion;

    offlineTargetUser = found;

    const resultArea = document.getElementById('offTargetCardArea');
    if (resultArea) {
        resultArea.style.display = 'block';

        let actionButtonHtml = '';
        if (userState.name && userState.birth) {
            actionButtonHtml = `<button onclick="calculateDirectOfflineCompatibility()" style="background-color:#5a3e36; margin-top:10px;">[ ${found.name} ] 님과 [ ${userState.name} ] 님의 궁합 확인하기 ➔</button>`;
        } else {
            actionButtonHtml = `<button onclick="proceedToOfflineApplicant()" style="background-color:#5a3e36; margin-top:10px;">[ ${found.name} ] 님과 내 궁합 확인하러 가기 (내 정보 입력) ➔</button>`;
        }

        resultArea.innerHTML = `
            <div class="partner-profile-card">
                <h3>${found.emoji ? found.emoji + ' ' : ''}${found.name} 님의 대상자 정보 확인</h3>
                <b>• 생년월일:</b> ${found.birth} (${found.calendarType || '양력'})<br>
                <b>• 성별:</b> ${found.gender || '미지정'} | <b>태어난 시간:</b> ${found.birthTime || '모름'}<br>
                <b>• 출생 지역:</b> ${found.birthRegion || '미지정'}<br>
                <b>• 사주 오행:</b> ${found.element || getSajuDetailFromBirth(found.birth).element}<br>
                <b>• 소속/정보:</b> ${found.dept || '-'}
            </div>
            ${actionButtonHtml}
        `;
    }
}

function calculateDirectOfflineCompatibility() {
    if (!offlineTargetUser || !userState.name) {
        proceedToOfflineApplicant();
        return;
    }

    const nameEl = document.getElementById('offAppName');
    const genderEl = document.getElementById('offAppGender');
    const birthEl = document.getElementById('offAppBirth');
    const calEl = document.getElementById('offAppCalendarType');
    const timeEl = document.getElementById('offAppBirthTime');
    const regionEl = document.getElementById('offAppBirthRegion');

    if (nameEl) nameEl.value = userState.name;
    if (genderEl) genderEl.value = userState.gender || "남";
    if (birthEl) birthEl.value = userState.birth || "";
    if (calEl) calEl.value = userState.calendarType || "양력";
    if (timeEl) timeEl.value = userState.birthTime || "모름";
    if (regionEl) regionEl.value = userState.birthRegion || "미지정";

    calculateOfflineCompatibility();
}

function proceedToOfflineApplicant() {
    if (!offlineTargetUser) {
        alert("인연등록서에 접수되지 않은 인원이옵니다. 성함과 생년월일을 다시금 확인해주소서!");
        return;
    }

    const bannerEl = document.getElementById('offTargetSummaryBanner');
    if (bannerEl) {
        bannerEl.innerHTML = `
            <b>💞 궁합 매칭 대상자:</b> ${offlineTargetUser.name} 님 (${offlineTargetUser.gender}, ${offlineTargetUser.element})
        `;
    }

    showStep('step_offline_applicant');
}

function calculateOfflineCompatibility() {
    const appName = document.getElementById('offAppName')?.value?.trim() || userState.name || "신청자";
    const appGender = document.getElementById('offAppGender')?.value || userState.gender || "남";
    const appBirth = document.getElementById('offAppBirth')?.value?.trim() || userState.birth || "";
    const appCalendarType = document.getElementById('offAppCalendarType')?.value || userState.calendarType || "양력";
    const appBirthTime = document.getElementById('offAppBirthTime')?.value || userState.birthTime || "모름";
    const appBirthRegion = document.getElementById('offAppBirthRegion')?.value?.trim() || userState.birthRegion || "미지정";

    if (!appGender || !appBirth || appBirth.length !== 6) {
        alert("본인 성별과 생년월일 6자리를 정확히 입력해주소서!");
        return;
    }

    const applicantUser = {
        name: appName,
        gender: appGender,
        birth: appBirth,
        calendarType: appCalendarType,
        birthTime: appBirthTime,
        birthRegion: appBirthRegion,
        element: getSajuDetailFromBirth(appBirth).element
    };

    const target = offlineTargetUser;

    const profilesEl = document.getElementById('offlineProfilesArea');
    if (profilesEl) {
        profilesEl.innerHTML = `
            <div class="offline-compare-grid">
                <div class="partner-profile-card" style="margin-bottom:0; font-size:12px;">
                    <h3 style="font-size:14px;">👤 ${applicantUser.name} (본인)</h3>
                    <b>• 오행:</b> ${applicantUser.element}<br>
                    <b>• 성별:</b> ${applicantUser.gender}<br>
                    <b>• 생일:</b> ${applicantUser.birth}<br>
                    <b>• 시간:</b> ${applicantUser.birthTime || '모름'}<br>
                    <b>• 지역:</b> ${applicantUser.birthRegion}
                </div>
                <div class="partner-profile-card" style="margin-bottom:0; font-size:12px; border-color:#b85d38;">
                    <h3 style="font-size:14px; color:#b85d38;">💖 ${target.name} (상대방)</h3>
                    <b>• 오행:</b> ${target.element}<br>
                    <b>• 성별:</b> ${target.gender}<br>
                    <b>• 생일:</b> ${target.birth}<br>
                    <b>• 시간:</b> ${target.birthTime || '모름'}<br>
                    <b>• 지역:</b> ${target.birthRegion}
                </div>
            </div>
        `;
    }

    const res = calculateSajuMatchEngine(applicantUser, target);

    const matchEl = document.getElementById('offlineMatchResultText');
    if (matchEl) {
        matchEl.innerHTML = `
            <b>[ 📜 오프라인 사주 궁합 종합 감정 ]</b><br><br>
            궁합 진단 점수: <b>[ ${res.score}점 / ${res.title} ]</b><br><br>
            ${res.exp1}<br><br>
            ${res.exp2}
        `;
    }

    showStep('step_offline_result');
}

// ==========================================
// 6. 사주 10개 일간별 동적 엔진
// ==========================================
function generateDynamicLoveFortune(name, birth, gender, dayGan, element) {
    const ganMap = {
        '甲': {
            star: "식상(食傷 - 식신/상관)",
            comp: "화(火) 또는 토(土)",
            period: "2026년 가을~겨울 및 2027년 초봄",
            style: "솔직 담백하고 뻗어나가는 직진형 연애 스타일! 사랑에 빠지면 당당하고 다정하게 매력을 발산합니다.",
            desc: "2026년 丙午년(병오년)은 甲木(갑목) 일간인 당신에게 강렬한 식상(食傷)의 기운을 불어넣습니다. 표현력과 개성이 크게 만개하여 호감을 가진 이성에게 자연스럽게 매력을 어필할 수 있는 결정적 시기입니다.",
            action: ["1. 대화 시 당당한 미소와 다정한 어조 유지하기", "2. 신록의 청록색 또는 화사한 붉은 계열 포인트 소품 활용", "3. 상대방의 장점을 사소하더라도 칭찬해 주는 표현 자주 쓰기", "4. 축제나 모임 등 인연이 모이는 자리에 자주 참석하기", "5. SNS 프로필을 밝고 기분 좋은 원색 사진으로 가꾸기"],
            item: "자신감을 불어넣는 세련된 에코백 또는 깔끔한 가죽 소재 팔찌"
        },
        '乙': {
            star: "식상(食傷 - 상관/식신)",
            comp: "화(火) 또는 금(金)",
            period: "2026년 하반기 및 2027년 봄 시즌",
            style: "유연하고 따뜻하며 상대를 깊이 배려하는 낭만적 연애 스타일! 섬세한 관심으로 연인의 마음을 사로잡습니다.",
            desc: "乙木(을목) 일간에게 2026 丙午년은 화려한 불꽃이 활짝 피어나는 상관(傷官)의 운입니다. 당신이 지닌 섬세함에 재치와 센스가 더해져 다정한 인연과의 만남이 활발해지는 시기입니다.",
            action: ["1. 다정다감한 눈맞춤과 경청하는 습관 기르기", "2. 파스텔 톤이나 따스한 핑크 계열 의상으로 호감도 올리기", "3. 상대방의 취향을 세심히 기억해 소소한 감동 건네기", "4. 가벼운 산책이나 은은한 카페 데이트 즐기기", "5. 마음에 드는 상대에게 조급해하지 않고 온화하게 다가가기"],
            item: "향긋한 플로럴 향수 또는 은은하게 반짝이는 은/로즈골드 액세서리"
        },
        '丙': {
            star: "비겁(比劫 - 비견/겁재)",
            comp: "토(土) 또는 금(金)",
            period: "2026년 가을 시즌 및 2027년 여름",
            style: "태양처럼 열정적이고 밝으며 솔직한 연애 스타일! 숨김없이 호감을 표현하며 활기찬 연애를 주도합니다.",
            desc: "丙火(병화) 일간에게 2026 丙午년은 나 자신과 같은 강렬한 비견(比肩)의 해입니다. 자신감과 주관이 확실해지며, 동년배나 마음이 통하는 친구 같은 인연과 극적인 연애 기운이 이어집니다.",
            action: ["1. 지나친 고집보다는 상대방의 의견을 들어주는 포용력 발휘하기", "2. 주황색이나 밝은 아이보리 계열 컬러 활용하기", "3. 야외 활동이나 동아리 모임에 활발히 참여하기", "4. 상대방을 존중하는 칭찬을 아끼지 않기", "5. 자신감 넘치면서도 친근한 표정 관리하기"],
            item: "활력을 더해주는 패션 시계 또는 깔끔한 스니커즈"
        },
        '丁': {
            star: "비겁(比劫 - 겁재/비견)",
            comp: "금(金) 또는 수(水)",
            period: "2026년 겨울 및 2027년 상반기",
            style: "촛불처럼 온화하고 은근히 깊은 열정을 지닌 연애 스타일! 은은한 따스함으로 상대를 감싸 안아줍니다.",
            desc: "丁火(정화) 일간에게 2026년은 내면의 열정이 조화롭게 커지는 시기입니다. 당신의 은은하고 깊은 다정함이 이성에게 특별하게 각인되는 운세입니다.",
            action: ["1. 속마음을 진솔하고 다정하게 어휘로 표현하기", "2. 차분한 딥브라운 또는 로즈골드 톤 스타일링", "3. 조용하고 분위기 있는 장소에서 차분하게 대화 나누기", "4. 상대방의 작은 고민을 온정 어리게 위로해주기", "5. SNS나 메시지 답장을 성의 있게 다정하게 작성하기"],
            item: "온기를 간직한 텀블러 또는 감성적인 분위기의 무드등 소품"
        },
        '戊': {
            star: "인성(印星 - 편인/정인)",
            comp: "금(金) 또는 수(水)",
            period: "2026년 가을 및 2027년 봄",
            style: "너른 대지처럼 든든하고 포용력 넘치는 연애 스타일! 믿음직스러운 모습으로 연인의 든든한 버팀목이 됩니다.",
            desc: "戊土(무토) 일간에게 2026 丙午년은 나를 다정하게 응원하고 품어주는 정인(正印)의 기운이 가득합니다. 나를 깊이 아껴주고 이해해 주는 귀인 같은 인연이 찾아오는 귀한 시기입니다.",
            action: ["1. 경청하는 든든한 태도로 신뢰감 심어주기", "2. 단정한 차콜 및 베이지 계열 의상 코디하기", "3. 약속 시간을 엄수하고 신용을 최우선으로 하기", "4. 깊이 있는 진솔한 주제로 대화 나누기", "5. 따스하고 온화한 미소로 인사를 건네기"],
            item: "고급스러운 가죽 다이어리 또는 깔끔한 프레임 안경/액세서리"
        },
        '己': {
            star: "인성(印星 - 정인/편인)",
            comp: "수(水) 또는 목(木)",
            period: "2026년 하반기 전반",
            style: "비옥한 흙처럼 자상하고 섬세하며 신중한 연애 스타일! 세심한 배려로 포근함을 선사합니다.",
            desc: "己土(기토) 일간에게 2026년은 마음의 안식과 자상함이 빛나는 해입니다. 당신의 상냥함과 신중함에 반한 이성이 성큼 다가오는 길한 기운이 형성됩니다.",
            action: ["1. 다정한 호응과 긍정적인 추임새 넣기", "2. 따뜻한 옐로우/카키 계열 의상 입기", "3. 정성스럽게 작성한 메모나 따뜻한 메시지 전하기", "4. 상대방의 기분을 세심히 살펴 배려해주기", "5. 차분하고 안정된 어조로 진심 전하기"],
            item: "촉촉한 핸드크림 또는 은은한 아로마 디퓨저/소품"
        },
        '庚': {
            star: "관성(官星 - 편관/정관)",
            comp: "수(水) 또는 목(木)",
            period: "2026년 가을~겨울 대길",
            style: "강인한 무쇠처럼 의리가 넘치고 결단력 있는 연애 스타일! 확실한 태도로 깔끔하고 당당하게 직진합니다.",
            desc: "庚金(경금) 일간에게 2026 丙午년은 나를 단련시키고 당당하게 만들어주는 관성(官星)의 운입니다. 남녀 모두 사주 내에 신뢰감 넘치는 인연과 연애 결실의 운이 강력하게 들어옵니다.",
            action: ["1. 확실하고 명확한 어조로 호감을 당당히 드러내기", "2. 깔끔하고 각 잡힌 셔츠나 블랙/네이비 의상 연출", "3. 예의 바르고 신사적인 매너 지키기", "4. 우유부단하지 않게 데이트 코스나 장소 리드하기", "5. 약속을 소중히 지키며 진실함을 어필하기"],
            item: "깔끔한 금속 메탈 시계 또는 명함지갑/카드지갑"
        },
        '辛': {
            star: "관성(官星 - 정관/편관)",
            comp: "목(木) 또는 화(火)",
            period: "2026년 하반기~2027년 초",
            style: "보석처럼 빛나고 섬세하며 완벽주의적인 연애 스타일! 정교한 감각과 높은 매너로 이성을 사로잡습니다.",
            desc: "辛金(신금) 일간에게 2026년은 나를 반짝반짝 조명해 주는 정관(正官)의 시기입니다. 세련된 매력이 도드라지며 당당하고 이상적인 이성이 다가오는 최고의 연애 운입니다.",
            action: ["1. 깔끔하고 단정한 용모와 스타일 유지하기", "2. 보석처럼 세련된 실버 또는 화이트 톤 스타일링", "3. 예의 바르고 기품 있는 어휘 사용하기", "4. 상대방의 장점을 예리하게 짚어 칭찬해주기", "5. 내면의 감정을 수줍어말고 은은하게 표현하기"],
            item: "반짝이는 실버 반지나 목걸이, 혹은 고급 펜"
        },
        '壬': {
            star: "재성(財星 - 편재/정재)",
            comp: "목(木) 또는 화(火)",
            period: "2026년 가을 및 2027년 봄",
            style: "넓은 바다처럼 지혜롭고 포용력 넘치는 연애 스타일! 자연스럽고 유쾌하게 상대를 편안하게 해줍니다.",
            desc: "壬水(임수) 일간에게 2026 丙午년은 활발한 결실과 결합을 뜻하는 재성(財星)의 기운입니다. 연애 기회가 매우 풍성해지며, 나와 가치관이 찰떡같이 맞는 천생연분을 만날 운세입니다.",
            action: ["1. 센스 넘치는 유머와 활기찬 대화 이끌기", "2. 시원한 블루 또는 감성적인 딥그레이 톤 착장", "3. 맛있는 음식이나 기분 좋은 소품 나눠먹기", "4. 유연하고 유쾌한 태도로 분위기 환하게 밝히기", "5. 좋아하는 마음을 감추지 말고 자연스럽게 드러내기"],
            item: "블루투스 이어폰 또는 감성적인 미니 가죽 소품"
        },
        '癸': {
            star: "재성(財星 - 정재/편재)",
            comp: "화(火) 또는 토(土)",
            period: "2026년 하반기 전반",
            style: "단비처럼 촉촉하고 감성적이며 섬세한 통찰력을 지닌 연애 스타일! 깊은 공감대로 연인의 마음을 녹입니다.",
            desc: "癸水(계수) 일간에게 2026년은 메마른 땅을 적시는 단비처럼 다정한 인연 결실의 운입니다. 상대방과 깊은 감정적 공감대를 나누며 연인 관계로 급발전하는 운세이옵니다.",
            action: ["1. 상대방의 말에 깊이 공감하고 지덕 있는 리액션 건네기", "2. 촉촉하고 깔끔한 분위기의 코디 연출", "3. 은은한 미소와 다정한 어조로 이야기나누기", "4. 소소한 일상을 공유하며 친밀감 키우기", "5. 따스한 마음을 담은 소소한 선물 건네기"],
            item: "촉촉한 립밤 또는 오행 기운을 돋우는 투명 원석 스트랩"
        }
    };

    const g = ganMap[dayGan] || ganMap['甲'];

    return `
<b>[ 💘 2026년 사주명리학 정통 연애운 감정 ]</b><br><br>
• <b>나를 표현하는 본원 오행:</b> <b>${element || '목(木)'} (${dayGan || '甲'}日干)</b><br>
• <b>나와 사주적으로 잘 어울리는 상대 오행:</b> <b>${g.comp}</b><br>
• <b>사주 십성(十星) 연애 운세:</b> <b>2026 丙午년 ${g.star} 운</b><br><br>
• <b>3년 이내 강력한 인연의 시기:</b> <b>${g.period}</b>에 나의 일간 기운을 활짝 꽃피워줄 강렬한 사주적 길연이 들어옵니다.<br><br>
• <b>사주로 본 나의 연애 스타일:</b> ${g.style}<br><br>
• <b>연애운 심층 명리 분석:</b> ${g.desc}<br><br>
• <b>2026년 하반기 연애운 상승 실천 5가지:</b><br>
${g.action[0]}<br>
${g.action[1]}<br>
${g.action[2]}<br>
${g.action[3]}<br>
${g.action[4]}<br><br>
• <b>🍀 나만의 연애 행운의 아이템:</b> <b>${g.item}</b>
`;
}

function generateDynamicTodayFortune(name, birth, gender, dayGan, element) {
    const ganTodayMap = {
        '甲': { color: "초록색 (Green)", num: "3, 8", item: "싱그러운 음료 또는 목재 소재 소품", total: "식신의 창의력이 발휘되어 아이디어가 샘솟고 매력이 드러나는 하루입니다.", money: "순탄하며 소소한 투자나 소비가 기분 전환이 됩니다.", study: "집중력이 뛰어난 날입니다.", love: "솔직한 호감 표현이 상대방의 마음을 움직입니다.", relation: "주변 사람들이 나의 밝은 활력에 이끌려 다가옵니다.", doAct: "미소 지으며 밝게 먼저 인사 건네기", dontAct: "섣부르게 상대를 조급하게 독촉하기", advice: "당신의 당당한 소신이 오늘 가장 커다란 매력입니다!" },
        '乙': { color: "파스텔 핑크 (Pastel Pink)", num: "1, 6", item: "플로럴 향수 또는 꽃 모양 키링", total: "상관의 센스와 유연함으로 주변을 온화하게 밝히는 운세입니다.", money: "안정적이며 나를 위한 소소한 선물이 유익합니다.", study: "창의적인 응용력이 고조되어 성과가 높아집니다.", love: "섬세한 배려가 상대방에게 깊은 안도감을 선사합니다.", relation: "오해가 풀어지고 다정한 대화가 만발합니다.", doAct: "따뜻한 경청과 호응 보여주기", dontAct: "타인의 작은 실수에 예민하게 반응하기", advice: "당신의 유연하고 따스한 마음이 길연을 불러옵니다!" },
        '丙': { color: "주황색 (Orange)", num: "2, 7", item: "패션 시계 또는 깔끔한 스니커즈", total: "비견의 강렬한 활력이 도래하여 능동적으로 일과 연애를 이끄는 날입니다.", money: "지출이 다소 발생할 수 있으나 유익한 인맥 형성에 쓰입니다.", study: "동료나 친구와 함께 공부할 때 시너지가 솟구칩니다.", love: "당당하고 열정적인 모습이 이성의 시선을 사로잡습니다.", relation: "의리 넘치는 행동으로 인기가 한층 상승합니다.", doAct: "자신감 넘치게 대화를 주도하기", dontAct: "자기 고집만 내세우고 타인 무시하기", advice: "솔직한 온기가 인연의 문을 활짝 열어줍니다!" },
        '丁': { color: "로즈골드 (Rose Gold)", num: "5, 9", item: "따뜻한 차 한 잔 또는 은은한 텀블러", total: "온화한 불꽃처럼 깊고 조화로운 내면의 매력이 돋보이는 날입니다.", money: "절약과 계획적 지출이 빛을 발하는 안정적인 날입니다.", study: "차분하고 정교하게 과제를 완수해냅니다.", love: "은은한 다정함에 상대방이 깊이 빠져듭니다.", relation: "진솔한 속마음을 터놓기에 대단히 적합합니다.", doAct: "따뜻한 어휘로 진심을 전달하기", dontAct: "감정을 숨기고 시무룩하게 굴기", advice: "당신의 차분한 진심은 언제나 통하는 법입니다!" },
        '戊': { color: "베이지/옐로우 (Beige)", num: "5, 10", item: "가죽 다이어리 또는 고급스러운 가방", total: "정인의 포용력이 펼쳐져 주변에서 나를 돕고 인정해 주는 날입니다.", money: "뜻밖의 재물이나 소소한 행운이 흘러들어옵니다.", study: "학업과 연구의 기운이 극에 달해 성과가 뛰어납니다.", love: "든든하고 신뢰감 넘치는 분위기가 상대 마음을 녹입니다.", relation: "나를 아껴주는 사람들의 귀인 운이 작용합니다.", doAct: "넉넉한 마음으로 웃어 넘겨주기", dontAct: "경솔하게 약속을 어기거나 미루기", advice: "산처럼 든든한 당신의 모습이 가장 빛납니다!" },
        '己': { color: "브라운 (Brown)", num: "4, 9", item: "촉촉한 핸드크림 또는 파우치", total: "자상함과 신중함이 결실을 이루어 뜻깊은 보람을 얻는 하루입니다.", money: "실속 있는 거래나 알뜰한 기쁨이 따릅니다.", study: "꼼꼼하게 체계적으로 정리가 잘 되는 날입니다.", love: "세심한 관심 표현에 상대방이 커다란 감동을 받습니다.", relation: "주변의 고민을 들어주며 평판이 대단히 좋아집니다.", doAct: "상대방의 노력을 진심으로 칭찬하기", dontAct: "지나치게 의심하거나 주저하기", advice: "당신의 자상한 따뜻함이 최고의 부적입니다!" },
        '庚': { color: "화이트/네이비 (White)", num: "4, 8", item: "금속 메탈 소재 액세서리나 카드지갑", total: "편관의 결단력과 의리가 결실을 맺어 주변의 인정을 받는 날입니다.", money: "투명하고 확실한 소비가 이로움을 선사합니다.", study: "목표 의식이 명확해져 빠른 속도로 일을 마칩니다.", love: "단당하고 절제된 매너가 커다란 호감을 불러일으킵니다.", relation: "리더십을 발휘하여 모임을 신나게 만듭니다.", doAct: "결단력 있게 깔끔한 태도 보여주기", dontAct: "감정적으로 거친 언사 사용하기", advice: "당신의 당당한 의리가 빛을 발하는 날입니다!" },
        '辛': { color: "실버 (Silver)", num: "1, 7", item: "반짝이는 실버 반지나 보석 모티브 소품", total: "정관의 고결함과 보석 같은 매력이 반짝반짝 빛을 발하는 대길한 날입니다.", money: "금전운이 상승하며 나를 가꾸는 투자에 좋습니다.", study: "예리한 분석력과 완벽한 감각이 돋보입니다.", love: "세련된 매너로 상대의 마음을 깊이 단숨에 사로잡습니다.", relation: "품격 있는 태도로 인지도가 쑥쑥 올라갑니다.", doAct: "단정하고 깔끔한 용모 연출하기", dontAct: "작은 실수에 사소하게 연연하기", advice: "당신은 존재 자체로 반짝이는 보석입니다!" },
        '壬': { color: "딥블루 (Deep Blue)", num: "2, 6", item: "블루투스 이어폰 또는 세련된 미니 소품", total: "넓은 바다 같은 지혜와 재성의 기운이 차올라 성과가 풍성한 날입니다.", money: "재물운이 활성화되어 유익한 기회가 들어옵니다.", study: "시야가 넓어져 복잡한 문제도 시원하게 해결합니다.", love: "유쾌하고 분위기 있는 대화로 연애운이 급상승합니다.", relation: "유연한 포용력으로 모든 사람과 잘 어울립니다.", doAct: "상대방과 함께 맛있는 음식 나누기", dontAct: "남의 시선을 지나치게 의식하기", advice: "넓은 바다처럼 여유롭고 당당하게 행동하세요!" },
        '癸': { color: "스카이블루 (Sky Blue)", num: "3, 9", item: "투명한 원석 스트랩 또는 깔끔한 보틀", total: "단비처럼 촉촉한 감성과 영감이 피어나 마음이 풍요로운 날입니다.", money: "지출이 가치 있게 쓰이며 유용한 정보를 얻습니다.", study: "섬세한 직관력이 발휘되어 이해도가 높습니다.", love: "깊은 감정적 공감대가 형성되어 연애 기운이 깊어집니다.", relation: "온화한 온정으로 사람들의 마음을 따스하게 해줍니다.", doAct: "따뜻한 음료 한 잔 나누며 대화하기", dontAct: "혼자만의 생각에 갇혀 침묵하기", advice: "촉촉한 당신의 다정함이 상대 마음을 적십니다!" }
    };

    const gt = ganTodayMap[dayGan] || ganTodayMap['甲'];

    return `
<b>[ 🔮 2026년 10월 1일 사주명리학 정통 오늘의 운세 ]</b><br><br>
• <b>행운의 컬러:</b> <b>${gt.color}</b><br>
• <b>행운의 숫자:</b> <b>${gt.num}</b><br>
• <b>오늘의 행운의 아이템:</b> <b>${gt.item}</b><br><br>
• <b>오늘의 총운:</b> ${gt.total}<br>
• <b>재물운:</b> ${gt.money}<br>
• <b>학업/직업운:</b> ${gt.study}<br>
• <b>연애운:</b> ${gt.love}<br>
• <b>인간관계운:</b> ${gt.relation}<br><br>
• <b>오늘 하면 좋은 행동:</b> ${gt.doAct}<br>
• <b>오늘 피하면 좋은 행동:</b> ${gt.dontAct}<br><br>
• <b>오늘의 한줄 조언:</b> <i>"${gt.advice}"</i>
`;
}

// ==========================================
// 7. HTML 이벤트 연결 바인딩
// ==========================================
window.showStep = showStep;
window.goBack = goBack;
window.goHome = goHome;
window.goToOfflineTargetSearch = goToOfflineTargetSearch;
window.calculateElement = calculateElement;
window.processTodayFortuneAI = processTodayFortuneAI;
window.processMatchAI = processMatchAI;
window.openBoxList = openBoxList;
window.saveAndReset = saveAndReset;
window.adminGrantMatchRight = adminGrantMatchRight;
window.goToBoxSelection = goToBoxSelection;
window.requestAdminCode = requestAdminCode;
window.saveApiKey = saveApiKey;
window.deleteData = deleteData;
window.searchOfflineTarget = searchOfflineTarget;
window.calculateDirectOfflineCompatibility = calculateDirectOfflineCompatibility;
window.proceedToOfflineApplicant = proceedToOfflineApplicant;
window.calculateOfflineCompatibility = calculateOfflineCompatibility;
