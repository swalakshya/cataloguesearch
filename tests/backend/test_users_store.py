"""Unit tests for UsersStore."""
import pytest

from backend.api.auth.users_store import EmailConflictError, UsersStore


@pytest.fixture
def store():
    s = UsersStore(":memory:")
    yield s
    s.close()


def test_get_by_id_missing_returns_none(store):
    assert store.get_by_id("nope") is None


def test_get_by_google_sub_missing_returns_none(store):
    assert store.get_by_google_sub("nope") is None


def test_get_by_email_missing_returns_none(store):
    assert store.get_by_email("nope@example.com") is None


def test_upsert_google_user_creates_new_user(store):
    user = store.upsert_google_user(
        google_sub="g-123", email="a@example.com", name="A", avatar_url="http://x/a.png"
    )
    assert user["email"] == "a@example.com"
    assert user["google_sub"] == "g-123"
    assert user["name"] == "A"
    assert user["avatar_url"] == "http://x/a.png"
    assert user["password_hash"] is None
    assert user["mobile_number"] is None
    assert user["created_at"] == user["last_login_at"]
    fetched = store.get_by_id(user["id"])
    assert fetched == user


def test_upsert_google_user_existing_google_sub_updates_and_reuses_id(store):
    first = store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    second = store.upsert_google_user(
        google_sub="g-1", email="a@example.com", name="A Renamed", avatar_url="http://x/a2.png"
    )
    assert second["id"] == first["id"]
    assert second["name"] == "A Renamed"
    assert second["avatar_url"] == "http://x/a2.png"
    assert second["last_login_at"] >= first["last_login_at"]
    assert store.query_count() == 1


def test_upsert_google_user_matches_existing_email_if_google_sub_new(store):
    # Edge case: a Phase-2 (password/mobile) account already exists by email
    # and is now completing Google login for the first time.
    first = store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    second = store.upsert_google_user(google_sub="g-2-different", email="a@example.com", name="A", avatar_url=None)
    assert second["id"] == first["id"]
    assert second["google_sub"] == "g-2-different"
    assert store.query_count() == 1


def test_get_by_google_sub(store):
    user = store.upsert_google_user(google_sub="g-9", email="z@example.com", name="Z", avatar_url=None)
    assert store.get_by_google_sub("g-9")["id"] == user["id"]


def test_get_by_email(store):
    user = store.upsert_google_user(google_sub="g-9", email="z@example.com", name="Z", avatar_url=None)
    assert store.get_by_email("z@example.com")["id"] == user["id"]


def test_two_distinct_users_both_persisted(store):
    store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    store.upsert_google_user(google_sub="g-2", email="b@example.com", name="B", avatar_url=None)
    assert store.query_count() == 2


def test_upsert_google_user_stores_given_name(store):
    user = store.upsert_google_user(
        google_sub="g-1", email="a@example.com", name="Rajat Jain", avatar_url=None, given_name="Rajat"
    )
    assert user["given_name"] == "Rajat"


def test_upsert_google_user_given_name_defaults_to_none(store):
    # Not every Google account necessarily returns a given_name claim -- the
    # column has to tolerate that rather than require it.
    user = store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    assert user["given_name"] is None


def test_upsert_google_user_update_changes_given_name(store):
    first = store.upsert_google_user(
        google_sub="g-1", email="a@example.com", name="Rajat Jain", avatar_url=None, given_name="Rajat"
    )
    second = store.upsert_google_user(
        google_sub="g-1", email="a@example.com", name="Rajat K. Jain", avatar_url=None, given_name="Rajat K."
    )
    assert second["id"] == first["id"]
    assert second["given_name"] == "Rajat K."


def test_users_store_given_name_survives_a_store_re_open_against_the_same_db_file(tmp_path):
    db_path = str(tmp_path / "users.db")
    store1 = UsersStore(db_path)
    store1.upsert_google_user(
        google_sub="g-1", email="a@example.com", name="Rajat Jain", avatar_url=None, given_name="Rajat"
    )
    store1.close()

    # Re-opening simulates a deploy against an existing DB file that predates
    # the given_name column -- the constructor's migration must not blow up
    # and must still let get_by_email select the (now-present) column.
    store2 = UsersStore(db_path)
    user = store2.get_by_email("a@example.com")
    assert user["given_name"] == "Rajat"
    store2.close()


def test_update_settings_missing_user_returns_none(store):
    assert store.update_settings("nope", '{"mode":"dark"}') is None


def test_update_settings_persists_and_returns_updated_row(store):
    user = store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    updated = store.update_settings(user["id"], '{"mode":"dark","palette":"forest"}')
    assert updated["settings_json"] == '{"mode":"dark","palette":"forest"}'
    fetched = store.get_by_id(user["id"])
    assert fetched["settings_json"] == '{"mode":"dark","palette":"forest"}'


def test_new_user_has_null_settings_json(store):
    user = store.upsert_google_user(google_sub="g-2", email="b@example.com", name="B", avatar_url=None)
    assert user["settings_json"] is None


def test_update_settings_overwrites_previous_value(store):
    user = store.upsert_google_user(google_sub="g-3", email="c@example.com", name="C", avatar_url=None)
    store.update_settings(user["id"], '{"mode":"dark"}')
    updated = store.update_settings(user["id"], '{"mode":"light"}')
    assert updated["settings_json"] == '{"mode":"light"}'


def test_users_store_settings_json_survives_a_store_re_open_against_the_same_db_file(tmp_path):
    db_path = str(tmp_path / "users.db")
    store1 = UsersStore(db_path)
    user = store1.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    store1.update_settings(user["id"], '{"mode":"dark"}')
    store1.close()

    # Re-opening simulates a deploy against an existing DB file that predates
    # the settings_json column -- the constructor's migration must not blow
    # up, and the previously-saved value must survive.
    store2 = UsersStore(db_path)
    fetched = store2.get_by_email("a@example.com")
    assert fetched["settings_json"] == '{"mode":"dark"}'
    store2.close()


def test_upsert_google_user_update_raises_clean_error_on_email_collision(store):
    # existing_by_google_sub finds a row by google_sub, but the email the
    # request wants to write there is already owned by a *different* row
    # (e.g. their Google account's email changed, or a Phase-2 account
    # already holds it) -- the UNIQUE constraint on email would otherwise
    # raise a raw sqlite3.IntegrityError straight out of this method.
    store.upsert_google_user(google_sub="g-1", email="a@example.com", name="A", avatar_url=None)
    store.upsert_google_user(google_sub="g-2", email="b@example.com", name="B", avatar_url=None)

    with pytest.raises(EmailConflictError):
        store.upsert_google_user(google_sub="g-2", email="a@example.com", name="B", avatar_url=None)

    # Neither row should have been corrupted by the failed write.
    assert store.get_by_google_sub("g-1")["email"] == "a@example.com"
    assert store.get_by_google_sub("g-2")["email"] == "b@example.com"
