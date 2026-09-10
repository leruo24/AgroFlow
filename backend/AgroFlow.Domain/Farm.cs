using System.Collections.ObjectModel;

namespace AgroFlow.Business
{
    public class Farm
    {
        #region Data Members
        private int farmId;
        private string farmName;
        private string location;
        private float totalArea;
        private Collection<Zone> zones;
        #endregion

        #region Property Methods
        public int FarmID
        {
            get { return farmId; }
            set { farmId = value; }
        }

        public string FarmName
        {
            get { return farmName; }
            set { farmName = value; }
        }

        public string Location
        {
            get { return location; }
            set { location = value; }
        }

        public float TotalArea
        {
            get { return totalArea; }
            set { totalArea = value; }
        }

        public Collection<Zone> Zones
        {
            get { return zones; }
        }
        #endregion

        #region Constructors
        public Farm()
        {
            farmId = 0;
            farmName = "";
            location = "";
            zones = new Collection<Zone>();
        }

        public Farm(int pFarmID, string pFarmName, string pLocation, float pTotalArea)
        {
            farmId = pFarmID;
            farmName = pFarmName;
            location = pLocation;
            totalArea = pTotalArea;
            zones = new Collection<Zone>();
        }
        #endregion

        #region Methods
        public void AddZone(Zone aZone)
        {
            zones.Add(aZone);
        }

        public string GetSummary()
        {
            return farmName + " (" + location + ") - " + zones.Count + " zone(s)";
        }
        #endregion
    }
}
