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
                    <tr onclick="selectUser('${user.userId}')" style="cursor: pointer;">
                        <td><strong>${user.userId}</strong></td>
                        <td><span class="badge bg-info text-dark">${user.academicCurrency}</span></td>
                        <td><span class="badge bg-secondary">${user.extraCurrency}</span></td>
                        <td><span class="badge bg-light text-dark">${user.idleCurrency}</span></td>
                        <td><span class="badge bg-success">${user.exp}</span></td>
                        <td class="small text-muted">${user.updatedAt}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="selectUser('${user.userId}')">수정</button>
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
function selectUser(userId) {
    document.getElementById("target-user-id").value = userId;
    document.getElementById("webhook-user-id").value = userId;
    
    // 강조 효과
    const input = document.getElementById("target-user-id");
    input.classList.add("is-valid");
    setTimeout(() => input.classList.remove("is-valid"), 1000);
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
