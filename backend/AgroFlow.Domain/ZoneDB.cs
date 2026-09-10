using System;
using System.Collections.ObjectModel;
using System.Data;
using Npgsql;
using NpgsqlTypes;
using AgroFlow.Business;

namespace AgroFlow.Data
{
    // Direct equivalent of the workshop's EmployeeDB.cs: concrete class (no interface),
    // holds an in-memory Collection<Zone> filled from the DataSet on construction,
    // with the DataRow<->Zone mapping done inline in private Add2Collection/FillRow
    // methods. No separate DTO class - the Zone business object itself is what the
    // data layer reads and writes, exactly like Employee in the workshop.
    //
    // IMPORTANT: I have not seen your actual 0001_schema.sql, so the table name
    // ("zones") and column names below are PLACEHOLDERS I could not verify. Replace
    // them with your real column names before running against Supabase.
    public class ZoneDB : DB
    {
        #region Data Members
        private string table = "zones";
        private string sqlLocal = "SELECT * FROM zones";
        private Collection<Zone> zones;
        #endregion

        #region Property Method
        public Collection<Zone> Zones
        {
            get { return zones; }
        }
        #endregion

        #region Constructor
        public ZoneDB(string connectionString) : base(connectionString)
        {
            zones = new Collection<Zone>();
            FillDataSet(sqlLocal, table);
            Add2Collection();
        }
        #endregion

        #region Utility Methods
        public DataSet GetDataSet()
        {
            return dsMain;
        }

        private void Add2Collection()
        {
            foreach (DataRow myRow in dsMain.Tables[table].Rows)
            {
                if (myRow.RowState != DataRowState.Deleted)
                {
                    Zone aZone = new Zone(
                        Convert.ToInt32(myRow["zone_id"]),
                        Convert.ToString(myRow["crop_type"]).TrimEnd());

                    aZone.Moisture = Convert.ToSingle(myRow["moisture"]);
                    aZone.Temperature = Convert.ToSingle(myRow["temperature"]);
                    aZone.Humidity = Convert.ToSingle(myRow["humidity"]);
                    aZone.WaterSaved = Convert.ToSingle(myRow["water_saved"]);

                    zones.Add(aZone);
                }
            }
        }

        private void FillRow(DataRow aRow, Zone aZone, DBOperation operation)
        {
            if (operation == DBOperation.Add)
            {
                aRow["zone_id"] = aZone.ZoneID;
            }

            aRow["crop_type"] = aZone.CropType;
            aRow["moisture"] = aZone.Moisture;
            aRow["temperature"] = aZone.Temperature;
            aRow["humidity"] = aZone.Humidity;
            aRow["water_saved"] = aZone.WaterSaved;
        }

        private int FindRow(Zone aZone)
        {
            int rowIndex = 0;
            foreach (DataRow myRow in dsMain.Tables[table].Rows)
            {
                if (myRow.RowState != DataRowState.Deleted)
                {
                    if (aZone.ZoneID == Convert.ToInt32(myRow["zone_id"]))
                        return rowIndex;
                }
                rowIndex++;
            }
            return -1;
        }
        #endregion

        #region Data Set Change (CRUD on the in-memory DataSet)
        public void DataSetChange(Zone aZone, DBOperation operation)
        {
            DataRow aRow;

            switch (operation)
            {
                case DBOperation.Add:
                    aRow = dsMain.Tables[table].NewRow();
                    FillRow(aRow, aZone, operation);
                    dsMain.Tables[table].Rows.Add(aRow);
                    break;

                case DBOperation.Edit:
                    int editIndex = FindRow(aZone);
                    if (editIndex == -1) break;
                    aRow = dsMain.Tables[table].Rows[editIndex];
                    FillRow(aRow, aZone, operation);
                    break;

                case DBOperation.Delete:
                    int deleteIndex = FindRow(aZone);
                    if (deleteIndex == -1) break;
                    aRow = dsMain.Tables[table].Rows[deleteIndex];
                    aRow.Delete();
                    break;
            }
        }
        #endregion

        #region Build Parameters, Create Commands & Update database
        private void BuildInsertParameters()
        {
            NpgsqlParameter param;

            param = new NpgsqlParameter("@zone_id", NpgsqlDbType.Integer, 4, "zone_id");
            daMain.InsertCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@crop_type", NpgsqlDbType.Varchar, 100, "crop_type");
            daMain.InsertCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@moisture", NpgsqlDbType.Real, 4, "moisture");
            daMain.InsertCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@temperature", NpgsqlDbType.Real, 4, "temperature");
            daMain.InsertCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@humidity", NpgsqlDbType.Real, 4, "humidity");
            daMain.InsertCommand.Parameters.Add(param);
        }

        private void CreateInsertCommand()
        {
            daMain.InsertCommand = new NpgsqlCommand(
                "INSERT INTO zones (zone_id, crop_type, moisture, temperature, humidity) " +
                "VALUES (@zone_id, @crop_type, @moisture, @temperature, @humidity)", cnMain);
            BuildInsertParameters();
        }

        private void BuildUpdateParameters()
        {
            NpgsqlParameter param;

            param = new NpgsqlParameter("@crop_type", NpgsqlDbType.Varchar, 100, "crop_type");
            param.SourceVersion = DataRowVersion.Current;
            daMain.UpdateCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@moisture", NpgsqlDbType.Real, 4, "moisture");
            param.SourceVersion = DataRowVersion.Current;
            daMain.UpdateCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@temperature", NpgsqlDbType.Real, 4, "temperature");
            param.SourceVersion = DataRowVersion.Current;
            daMain.UpdateCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@humidity", NpgsqlDbType.Real, 4, "humidity");
            param.SourceVersion = DataRowVersion.Current;
            daMain.UpdateCommand.Parameters.Add(param);

            param = new NpgsqlParameter("@original_zone_id", NpgsqlDbType.Integer, 4, "zone_id");
            param.SourceVersion = DataRowVersion.Original;
            daMain.UpdateCommand.Parameters.Add(param);
        }

        private void CreateUpdateCommand()
        {
            daMain.UpdateCommand = new NpgsqlCommand(
                "UPDATE zones SET crop_type = @crop_type, moisture = @moisture, " +
                "temperature = @temperature, humidity = @humidity " +
                "WHERE zone_id = @original_zone_id", cnMain);
            BuildUpdateParameters();
        }

        private void BuildDeleteParameters()
        {
            NpgsqlParameter param = new NpgsqlParameter("@original_zone_id", NpgsqlDbType.Integer, 4, "zone_id");
            param.SourceVersion = DataRowVersion.Original;
            daMain.DeleteCommand.Parameters.Add(param);
        }

        private void CreateDeleteCommand()
        {
            daMain.DeleteCommand = new NpgsqlCommand("DELETE FROM zones WHERE zone_id = @original_zone_id", cnMain);
            BuildDeleteParameters();
        }

        public bool UpdateDataSource(Zone aZone)
        {
            CreateInsertCommand();
            CreateUpdateCommand();
            CreateDeleteCommand();
            return UpdateDataSource(sqlLocal, table);
        }
        #endregion
    }
}
