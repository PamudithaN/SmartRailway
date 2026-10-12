// Replaces a route's ordered station list, creating any station names that do not exist yet.
// Station names are matched case-insensitively so a junction is one row shared by several routes.
export const setRouteStations = async (client, routeId, names) => {
  await client.query('DELETE FROM route_stations WHERE route_id = $1', [routeId]);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const found = await client.query('SELECT id FROM stations WHERE lower(name) = lower($1)', [name]);
    let stationId = found.rows[0]?.id;
    if (stationId === undefined) {
      const inserted = await client.query(
        `INSERT INTO stations (name) VALUES ($1)
         ON CONFLICT (lower(name)) DO UPDATE SET name = stations.name RETURNING id`,
        [name]
      );
      stationId = inserted.rows[0].id;
    }
    await client.query(
      'INSERT INTO route_stations (route_id, station_id, position) VALUES ($1, $2, $3)',
      [routeId, stationId, i + 1]
    );
  }
};
