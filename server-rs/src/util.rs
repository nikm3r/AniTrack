use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::Row;
use serde_json::{json, Map, Value};

/// JS-like `String(v)` for the values the settings API accepts.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 1e15 {
                    return format!("{}", f as i64);
                }
            }
            n.to_string()
        }
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}

/// Convert a JSON value to something SQLite can store (objects/arrays become JSON text).
pub fn json_to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// Convert a row to a JSON object keyed by column name.
pub fn row_to_json(row: &Row, cols: &[String]) -> rusqlite::Result<Value> {
    let mut m = Map::new();
    for (i, name) in cols.iter().enumerate() {
        let v = match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => json!(n),
            ValueRef::Real(f) => json!(f),
            ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(_) => Value::Null,
        };
        m.insert(name.clone(), v);
    }
    Ok(Value::Object(m))
}

/// Parse the `genres` JSON-string column into an array (like the Node server does).
pub fn with_genres(mut anime: Value) -> Value {
    if let Value::Object(m) = &mut anime {
        let parsed = match m.get("genres") {
            Some(Value::String(s)) if !s.is_empty() => {
                serde_json::from_str::<Value>(s).unwrap_or_else(|_| json!([]))
            }
            _ => json!([]),
        };
        m.insert("genres".into(), parsed);
    }
    anime
}
