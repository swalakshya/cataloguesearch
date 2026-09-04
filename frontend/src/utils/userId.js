function getOrCreateUserId() {
    const key = 'swalakshya_user_id';
    let id = localStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
    }
    return id;
}

export const USER_ID = getOrCreateUserId();
