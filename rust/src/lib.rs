use diesel_async::AsyncPgConnection;
use diesel_async::pooled_connection::AsyncDieselConnectionManager;
use diesel_async::pooled_connection::bb8::Pool;

use dotenvy::dotenv;
use std::env;

pub type DbPool = Pool<AsyncPgConnection>;

pub async fn establish_connection_pool() -> DbPool {
    dotenv().ok();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    establish_async_pool(&database_url).await
}

async fn establish_async_pool(database_url: &str) -> DbPool {
    // Manager for AsyncPgConnection (postgres)
    let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);

    // bb8 pool
    Pool::builder()
        .max_size(128)
        .min_idle(16)
        .connection_timeout(std::time::Duration::from_secs(5))
        .build(config)
        .await
        .expect("Failed to create async pool")
}

pub mod models;
pub mod queries;
pub mod schema;
