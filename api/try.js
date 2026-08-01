export async function insertNameToTestTable(name, env) {
    await env.road_map_db
        .prepare("INSERT INTO test_table (name) VALUES (?)")
        .bind(name)
        .run();

    const { results } = await env.road_map_db
        .prepare("SELECT * FROM test_table")
        .all();

    return Response.json(results);
}