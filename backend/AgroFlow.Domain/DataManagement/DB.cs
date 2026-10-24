using System;
using System.Data;
using Npgsql;

namespace AgroFlow.Data
{
    // Base class like the workshop's DB.cs: a shared connection, DataSet and
    // DataAdapter, with FillDataSet/UpdateDataSource used by every XDB class.
    // We use Npgsql instead of SqlClient because the database is Supabase (Postgres);
    // the DataSet pattern stays the same.
    public class DB
    {
        public enum DBOperation
        {
            Add = 0,
            Edit = 1,
            Delete = 2
        }

        #region Data Members
        // The connection string comes from the API's configuration through the constructor.
        private string strConn;
        protected NpgsqlConnection cnMain;
        protected DataSet dsMain;
        protected NpgsqlDataAdapter daMain;
        #endregion

        #region Constructor
        public DB(string connectionString)
        {
            try
            {
                strConn = connectionString;
                cnMain = new NpgsqlConnection(strConn);
                dsMain = new DataSet();
            }
            catch (Exception e)
            {
                Console.WriteLine("Error: " + e.Message);
                throw;
            }
        }
        #endregion

        #region Update the DataSet
        public void FillDataSet(string aSqlString, string aTable)
        {
            try
            {
                daMain = new NpgsqlDataAdapter(aSqlString, cnMain);
                cnMain.Open();
                daMain.Fill(dsMain, aTable);
                cnMain.Close();
            }
            catch (Exception errObj)
            {
                Console.WriteLine(errObj.Message + "  " + errObj.StackTrace);
            }
        }
        #endregion

        #region Update the data source
        protected bool UpdateDataSource(string sqlLocal, string table)
        {
            bool success;
            try
            {
                cnMain.Open();
                daMain.Update(dsMain, table);
                cnMain.Close();
                FillDataSet(sqlLocal, table);
                success = true;
            }
            catch (Exception errObj)
            {
                Console.WriteLine(errObj.Message + "  " + errObj.StackTrace);
                success = false;
            }
            return success;
        }
        #endregion
    }
}
