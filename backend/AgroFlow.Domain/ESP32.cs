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
        // override: the board does not measure anything, so its value is 1 when
        // connected and 0 when not.
        public override float ReadValue()
        {
            return connectionStatus == "Connected" ? 1f : 0f;
        }
        #endregion
    }
}
