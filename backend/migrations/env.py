from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import get_settings
from app.models import Base


config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    # Test runners may supply an isolated connection. Never interpolate the URL
    # into ConfigParser: percent-encoded passwords must remain intact.
    connection = config.attributes.get("connection")
    if connection is not None:
        run_with_connection(connection)
        return
    engine = create_engine(get_settings().database_url, poolclass=pool.NullPool)
    try:
        with engine.connect() as connection:
            run_with_connection(connection)
    finally:
        engine.dispose()


def run_with_connection(connection):
    if connection.dialect.name != "postgresql":
        raise RuntimeError("CampusFix migrations require PostgreSQL")
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
