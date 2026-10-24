using System;

namespace AgroFlow.Business
{
    // Base class of the hardware hierarchy, like the workshop's Role class:
    // Hardware has a HardwareType enum and Sensor, Pump and ESP32 inherit from it.
    public class Hardware
    {
        #region Data Member
        public enum HardwareType
        {
            // Like Role.RoleType: no type yet (0), or one of the three device kinds.
            NoType = 0,
            Sensor = 1,
            Pump = 2,
            ESP32 = 3
        }

        // protected so the subclasses can use them (Notes 2.3).
        protected int hardwareId;
        protected string deviceName;
        protected HardwareType hardwareTypeValue;
        protected string status;
        protected DateTime lastSeen;
        #endregion

        #region Property Methods
        public int HardwareID
        {
            get { return hardwareId; }
            set { hardwareId = value; }
        }

        public string DeviceName
        {
            get { return deviceName; }
            set { deviceName = value; }
        }

        public HardwareType GetHardwareType
        {
            get { return hardwareTypeValue; }
            set { hardwareTypeValue = value; }
        }

        public string Status
        {
            get { return status; }
            set { status = value; }
        }

        public DateTime LastSeen
        {
            get { return lastSeen; }
            set { lastSeen = value; }
        }
        #endregion

        #region Constructor
        // The default constructor starts with no type, like Role() starts with NoRole.
        public Hardware()
        {
            hardwareTypeValue = HardwareType.NoType;
            status = "Offline";
            lastSeen = DateTime.Now;
        }
        #endregion

        #region Methods
        // virtual: each device kind reports its current value differently,
        // like Role.Payment() (Notes 2.4).
        public virtual float ReadValue()
        {
            return 0f;
        }

        // virtual: subclasses can refine what "working" means, e.g. a Pump.
        public virtual bool IsWorking()
        {
            return status == "Online";
        }
        #endregion
    }
}
