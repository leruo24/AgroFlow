namespace AgroFlow.Business
{
    public class Pump : Hardware
    {
        #region Data Member
        private float flowRate;
        private bool isRunning;
        #endregion

        #region Property Methods
        public float FlowRate
        {
            get { return flowRate; }
            set { flowRate = value; }
        }

        public bool IsRunning
        {
            get { return isRunning; }
            set { isRunning = value; }
        }
        #endregion

        #region Constructor
        public Pump() : base()
        {
            GetHardwareType = HardwareType.Pump;
            status = "Offline";
            flowRate = 0f;
            isRunning = false;
        }
        #endregion

        #region Methods
        // override: a pump's value is its flow rate while running, otherwise 0.
        public override float ReadValue()
        {
            return isRunning ? flowRate : 0f;
        }

        // override: a pump only counts as working if it is online and pumping when
        // it should be, a stricter check than the base class (Notes 2.4).
        public override bool IsWorking()
        {
            return status == "Online" || status == "Running";
        }
        #endregion
    }
}
