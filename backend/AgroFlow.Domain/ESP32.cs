namespace AgroFlow.Business
{
    public class ESP32 : Hardware
    {
        #region Data Member
        private string ipAddress;
        private string connectionStatus;
        #endregion

        #region Property Methods
        public string IpAddress
        {
            get { return ipAddress; }
            set { ipAddress = value; }
        }

        public string ConnectionStatus
        {
            get { return connectionStatus; }
            set { connectionStatus = value; }
        }
        #endregion

        #region Constructor
        public ESP32() : base()
        {
            GetHardwareType = HardwareType.ESP32;
            status = "Offline";
            connectionStatus = "Disconnected";
        }
        #endregion

        #region Methods
        // override: an ESP32 board's "value" is a simple 1/0 link indicator
        // (connected or not), since the board itself isn't a measuring device.
        public override float ReadValue()
        {
            return connectionStatus == "Connected" ? 1f : 0f;
        }
        #endregion
    }
}
