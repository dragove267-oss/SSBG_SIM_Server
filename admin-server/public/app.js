// API Base URL
const API_BASE = "/api/admin";

// 초기화: 유저 리스트 로드
document.addEventListener("DOMContentLoaded", () => {
    loadUsers();
    
    // 30초마다 자동 갱신
    setInterval(loadUsers, 30000);
});

// 1. 유저 리스트 로드
async function loadUsers() {
    const userListBody = document.getElementById("user-list");
    
    try {
        const res = await fetch(`${API_BASE}/users`);
        const data = await res.json();
        
        if (data.success) {
            userListBody.innerHTML = "";
            data.users.forEach(user => {
                const row = `
                    <tr onclick="selectUser('${user.userId}', this)" style="cursor: pointer;">
                        <td><strong>${user.userId}</strong></td>
                        <td><span class="badge bg-info text-dark">${user.academicCurrency}</span></td>
                        <td><span class="badge bg-secondary">${user.extraCurrency}</span></td>
                        <td><span class="badge bg-light text-dark">${user.idleCurrency}</span></td>
                        <td><span class="badge bg-success">${user.exp}</span></td>
                        <td class="small text-muted">${user.updatedAt}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); selectUser('${user.userId}', this.closest('tr'))">선택</button>
                        </td>
                    </tr>
                `;
                userListBody.innerHTML += row;
            });
        }
    } catch (err) {
        console.error("User loading failed:", err);
    }
}

// 2. 유저 선택 (수정 폼에 ID 입력)
function selectUser(userId, element) {
    // 입력창에 ID 채우기
    document.getElementById("target-user-id").value = userId;
    document.getElementById("webhook-user-id").value = userId;
    
    // 배지 표시
    const badge = document.getElementById("selected-user-badge");
    badge.classList.remove("d-none");
    badge.innerText = `선택됨: ${userId}`;
    
    // 기존 선택된 행 하이라이트 제거
    const rows = document.querySelectorAll("#user-list tr");
    rows.forEach(r => r.classList.remove("table-primary"));
    
    // 현재 선택된 행 하이라이트 추가
    if (element) {
        element.classList.add("table-primary");
    }
    
    // 수정 폼으로 스크롤 이동 (필요 시)
    document.getElementById("target-user-id").focus();
    
    // 시각적 피드백 (반짝임)
    const input = document.getElementById("target-user-id");
    input.style.backgroundColor = "#e8f0fe";
    setTimeout(() => input.style.backgroundColor = "", 500);
}

// 3. 데이터 수정 요청 (지급/차감)
async function modifyData(action) {
    const userId = document.getElementById("target-user-id").value;
    const currencyType = document.getElementById("currency-type").value;
    const amount = document.getElementById("modify-amount").value;
    
    if (!userId || !amount) {
        alert("유저 ID와 수량을 입력해주세요.");
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/user/modify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, currencyType, amount, action })
        });
        const data = await res.json();
        
        if (data.success) {
            alert(`성공: ${action === 'gain' ? '지급' : '차감'} 완료!`);
            loadUsers(); // 리스트 갱신
        } else {
            alert(`실패: ${data.error.error || data.error}`);
        }
    } catch (err) {
        alert("서버 통신 중 오류가 발생했습니다.");
    }
}

// 4. 웹훅 트리거
async function triggerWebhook() {
    const userId = document.getElementById("webhook-user-id").value;
    
    if (!userId) {
        alert("대상이 될 유저 ID를 입력해주세요.");
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/school/trigger-update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        
        if (data.success) {
            alert("학교 데이터 업데이트 및 웹훅 발송 성공!");
            setTimeout(loadUsers, 1000); // 반영 대기 후 갱신
        } else {
            alert(`실패: ${data.error.error || data.error}`);
        }
    } catch (err) {
        alert("웹훅 트리거 중 오류가 발생했습니다.");
    }
}
