using System;
using System.Data;
using Npgsql;

namespace AgroFlow.Data
{
    // Direct equivalent of the workshop's DB.cs base class: shared Connection,
    // DataSet and DataAdapter, with FillDataSet/UpdateDataSource reused by every
    // concrete XDB class. Swapped from SqlConnection/SqlDataAdapter (SQL Server) to
    // NpgsqlConnection/NpgsqlDataAdapter because the real backend is Supabase
    // (Postgres). Npgsql implements the same DbDataAdapter/DataSet model, so the
    // taught pattern is unchanged - only the provider differs.
    public class DB
    {
        public enum DBOperation
        {
            Add = 0,
            Edit = 1,
            Delete = 2
        }

        #region Data Members
        // The workshop read this from Settings.Default (app.config). Here it is
        // passed into the constructor, so it comes from the API's configuration.
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
