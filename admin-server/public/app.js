// API Base URL
const API_BASE = "/api/admin";
let allUsers = [];

// 초기화: 유저 리스트 로드
document.addEventListener("DOMContentLoaded", () => {
    loadUsers();
    setInterval(loadUsers, 30000);

    const userDropdown = document.getElementById("user-select-dropdown");
    userDropdown.addEventListener("change", (e) => {
        const userId = e.target.value;
        if (userId) selectUser(userId);
    });
});

// 1. 유저 리스트 로드 및 드롭다운 갱신
async function loadUsers() {
    const userListBody = document.getElementById("user-list");
    const dropdown = document.getElementById("user-select-dropdown");
    const currentSelectedId = document.getElementById("target-user-id").value;
    
    try {
        const res = await fetch(`${API_BASE}/users`);
        const data = await res.json();
        
        if (data.success && data.users) {
            allUsers = data.users;
            userListBody.innerHTML = "";
            data.users.forEach(user => {
                const isSelected = user.userId === currentSelectedId;
                const row = `
                    <tr onclick="selectUser('${user.userId}', this)" style="cursor: pointer;" class="${isSelected ? 'table-primary' : ''}">
                        <td><strong>${user.userId}</strong></td>
                        <td><span class="badge bg-info text-dark">${user.academicCurrency}</span></td>
                        <td><span class="badge bg-secondary">${user.extraCurrency}</span></td>
                        <td><span class="badge bg-light text-dark">${user.idleCurrency}</span></td>
                        <td><span class="badge bg-success">${user.exp}</span></td>
                        <td class="small text-muted">${user.updatedAt}</td>
                        <td><button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); selectUser('${user.userId}', this.closest('tr'))">선택</button></td>
                    </tr>
                `;
                userListBody.innerHTML += row;
            });

            dropdown.innerHTML = '<option value="" disabled>수정할 유저를 선택하세요</option>';
            data.users.forEach(user => {
                const option = document.createElement("option");
                option.value = user.userId;
                option.textContent = `${user.userId}`;
                if (user.userId === currentSelectedId) option.selected = true;
                dropdown.appendChild(option);
            });
        }
    } catch (err) {
        console.error("User loading failed:", err);
    }
}

// 2. 유저 선택 시 편집 표에 데이터 채우기
function selectUser(userId, element) {
    const user = allUsers.find(u => u.userId === userId);
    if (!user) return;

    // 데이터 바인딩 (Hidden 및 Webhook 필드)
    document.getElementById("target-user-id").value = userId;
    document.getElementById("webhook-user-id").value = userId;
    document.getElementById("user-select-dropdown").value = userId;
    
    // 편집 표(Input Cells)에 데이터 채우기
    document.getElementById("edit-academic").value = user.academicCurrency;
    document.getElementById("edit-extra").value = user.extraCurrency;
    document.getElementById("edit-idle").value = user.idleCurrency;
    document.getElementById("edit-exp").value = user.exp;

    // UI 노출 제어
    document.getElementById("edit-table-container").classList.remove("d-none");
    document.getElementById("no-selection-msg").classList.add("d-none");
    
    const badge = document.getElementById("selected-user-badge");
    badge.classList.remove("d-none");
    badge.innerText = `선택됨: ${userId}`;
    
    // 테이블 하이라이트
    const rows = document.querySelectorAll("#user-list tr");
    rows.forEach(r => r.classList.remove("table-primary"));
    if (element) element.classList.add("table-primary");
    else {
        rows.forEach(r => { if (r.cells[0]?.innerText === userId) r.classList.add("table-primary"); });
    }
}

// 3. 편집된 데이터 서버에 저장 (Override)
async function updateUserData() {
    const userId = document.getElementById("target-user-id").value;
    if (!userId) return;

    const stats = {
        academicCurrency: parseInt(document.getElementById("edit-academic").value),
        extraCurrency:    parseInt(document.getElementById("edit-extra").value),
        idleCurrency:     parseInt(document.getElementById("edit-idle").value),
        exp:              parseInt(document.getElementById("edit-exp").value)
    };

    if (Object.values(stats).some(isNaN)) {
        alert("모든 필드에 올바른 숫자를 입력해주세요.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/user/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, stats })
        });
        const data = await res.json();
        
        if (data.success) {
            alert(`성공: ${userId} 유저 데이터가 성공적으로 수정되었습니다.`);
            loadUsers(); // 목록 갱신
        } else {
            alert(`실패: ${data.error}`);
        }
    } catch (err) {
        alert("서버 통신 중 오류가 발생했습니다.");
    }
}

// 4. 웹훅 트리거
async function triggerWebhook() {
    const userId = document.getElementById("webhook-user-id").value;
    if (!userId) { alert("대상이 될 유저 ID를 선택해주세요."); return; }
    
    try {
        const res = await fetch(`${API_BASE}/school/trigger-update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (data.success) {
            alert("학교 데이터 업데이트 및 웹훅 발송 성공!");
            setTimeout(loadUsers, 1000); 
        } else {
            alert(`실패: ${data.error}`);
        }
    } catch (err) {
        alert("웹훅 트리거 중 오류가 발생했습니다.");
    }
}
