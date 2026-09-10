using System;

namespace AgroFlow.Business
{
    // Base class of the hardware hierarchy - the direct analogue of the workshop's
    // Role class. Just as Role has a RoleType enum and HeadWaiter/Waiter/Runner
    // derive from it, Hardware has a HardwareType enum and Sensor/Pump/ESP32 derive
    // from it. The class diagram draws exactly this: three device boxes with
    // hollow-triangle inheritance arrows into Hardware.
    public class Hardware
    {
        #region Data Member
        public enum HardwareType
        {
            // Same idea as Role.RoleType - a device is not-yet-typed (0), or one of
            // the three concrete kinds.
            NoType = 0,
            Sensor = 1,
            Pump = 2,
            ESP32 = 3
        }

        // protected so derived classes can reuse them (Notes 2.3), matching how
        // Role exposes roleVal/description to HeadWaiter/Waiter/Runner.
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
        // Default constructor initialises to "no type" - mirrors Role() defaulting
        // to NoRole until a specific role is assigned.
        public Hardware()
        {
            hardwareTypeValue = HardwareType.NoType;
            status = "Offline";
            lastSeen = DateTime.Now;
        }
        #endregion

        #region Methods
        // Overridable - each device kind reports its "current value" differently.
        // This is the Hardware-hierarchy equivalent of Role.Payment(): a virtual
        // method with a base implementation, overridden in each subclass (Notes 2.4).
        public virtual float ReadValue()
        {
            return 0f;
        }

        // Overridable working-status check - a base version that subclasses can
        // refine (e.g. a Pump is "working" on a different basis than a Sensor).
        public virtual bool IsWorking()
        {
            return status == "Online";
        }
        #endregion
    }
}
