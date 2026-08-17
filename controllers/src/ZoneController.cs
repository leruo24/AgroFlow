using System.Collections.ObjectModel;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    // Direct equivalent of the workshop's EmployeeController: holds a reference to
    // the XDB class and a Collection<T>, exposes the collection, and forwards
    // add/edit/delete + finalize to the DB class. No business logic in the DB layer;
    // the controller coordinates (Notes: control classes coordinate activity, they
    // don't hold business rules).
    public class ZoneController
    {
        #region Data Members
        private ZoneDB zoneDB;
        private Collection<Zone> zones;
        #endregion

        #region Constructor
        public ZoneController(string connectionString)
        {
            zoneDB = new ZoneDB(connectionString);
            zones = zoneDB.Zones;
        }
        #endregion

        #region Properties
        public Collection<Zone> AllZones
        {
            get { return zones; }
        }
        #endregion

        #region Database Communication
        public void DataMaintenance(Zone aZone, DB.DBOperation operation)
        {
            // change the in-memory DataSet + collection
            zoneDB.DataSetChange(aZone, operation);

            if (operation == DB.DBOperation.Add)
                zones.Add(aZone);
            else if (operation == DB.DBOperation.Delete)
                zones.Remove(aZone);
        }

        public bool FinalizeChanges(Zone aZone)
        {
            return zoneDB.UpdateDataSource(aZone);
        }
        #endregion
    }
}
