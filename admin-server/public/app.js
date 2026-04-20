// API Base URL
const API_BASE = "/api/admin";

// 초기화: 유저 리스트 로드
document.addEventListener("DOMContentLoaded", () => {
    loadUsers();
    
    // 30초마다 자동 갱신
    setInterval(loadUsers, 30000);

    // 드롭다운 선택 이벤트: 유저 선택 시 자동 채우기
    const userDropdown = document.getElementById("user-select-dropdown");
    userDropdown.addEventListener("change", (e) => {
        const userId = e.target.value;
        if (userId) {
            selectUser(userId);
        }
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
            // 1) 테이블 렌더링
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
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); selectUser('${user.userId}', this.closest('tr'))">선택</button>
                        </td>
                    </tr>
                `;
                userListBody.innerHTML += row;
            });

            // 2) 드롭다운 갱신
            dropdown.innerHTML = '<option value="" disabled>수정할 유저를 선택하세요</option>';
            data.users.forEach(user => {
                const option = document.createElement("option");
                option.value = user.userId;
                option.textContent = `${user.userId} (재화: ${user.academicCurrency} | EXP: ${user.exp})`;
                if (user.userId === currentSelectedId) option.selected = true;
                dropdown.appendChild(option);
            });

            if (!currentSelectedId) {
                dropdown.selectedIndex = 0; // 선택된 게 없으면 첫 번째 가이드 문구 선택
            }

        } else if (data.users && data.users.length === 0) {
            userListBody.innerHTML = "<tr><td colspan='7' class='text-center py-4 text-muted'>등록된 유저가 없습니다.</td></tr>";
            dropdown.innerHTML = '<option value="" disabled selected>등록된 유저 없음</option>';
        }
    } catch (err) {
        console.error("User loading failed:", err);
        userListBody.innerHTML = "<tr><td colspan='7' class='text-center py-4 text-danger'>데이터 로드 실패</td></tr>";
    }
}

// 2. 유저 선택 시 데이터 동기화
function selectUser(userId, element) {
    // 1) 데이터 바인딩
    document.getElementById("target-user-id").value = userId;
    document.getElementById("webhook-user-id").value = userId;
    document.getElementById("user-select-dropdown").value = userId; // 드롭다운 값 변경
    
    // 2) 시각적 표시
    const badge = document.getElementById("selected-user-badge");
    const infoArea = document.getElementById("selected-user-info");
    const displayId = document.getElementById("display-user-id");

    badge.classList.remove("d-none");
    badge.innerText = `선택됨: ${userId}`;
    infoArea.classList.remove("d-none");
    displayId.innerText = userId;
    
    // 3) 테이블 하이라이트 처리
    const rows = document.querySelectorAll("#user-list tr");
    rows.forEach(r => r.classList.remove("table-primary"));
    
    if (element) {
        element.classList.add("table-primary");
    } else {
        // ID로 행을 찾아 하이라이트 추가
        rows.forEach(r => {
            if (r.cells[0]?.innerText === userId) {
                r.classList.add("table-primary");
            }
        });
    }
}

// 3. 데이터 수정 요청 (지급/차감)
async function modifyData(action) {
    const userId = document.getElementById("target-user-id").value;
    const currencyType = document.getElementById("currency-type").value;
    const amount = document.getElementById("modify-amount").value;
    
    if (!userId || !amount) {
        alert("유저를 선택하고 수량을 입력해주세요.");
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
            loadUsers(); // 리스트 갱신 (선택 상태 유지됨)
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
        alert("대상이 될 유저 ID를 선택해주세요.");
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
            setTimeout(loadUsers, 1000); 
        } else {
            alert(`실패: ${data.error.error || data.error}`);
        }
    } catch (err) {
        alert("웹훅 트리거 중 오류가 발생했습니다.");
    }
}
