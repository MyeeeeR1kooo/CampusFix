import pytest


def test_get_db_closes_the_session_after_request(monkeypatch):
    from app.core import database

    class FakeSession:
        closed = False

        def close(self):
            self.closed = True

    session = FakeSession()
    monkeypatch.setattr(database, "SessionLocal", lambda: session)

    dependency = database.get_db()
    assert next(dependency) is session

    with pytest.raises(StopIteration):
        next(dependency)
    assert session.closed is True


def test_database_module_does_not_create_tables():
    from app.core import database

    assert not hasattr(database, "Base")
    assert not hasattr(database, "create_all")
